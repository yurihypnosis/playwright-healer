/**
 * Phase C step 2: locate each proposal's locator call in the source via
 * ts-morph and rewrite it to the adopted locator. The receiver expression
 * (page, this.page, a page-object field, …) is preserved; only the builder
 * call itself is replaced.
 */

import { Node, Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import type { PatchProposal, PatchWarning } from './aggregate.js';

export interface FileEdit {
  file: string;
  line: number;
  before: string;
  after: string;
  proposal: PatchProposal;
}

export interface CodemodResult {
  edits: FileEdit[];
  warnings: PatchWarning[];
  /** Full new contents per file, for diffing / writing. */
  changedFiles: Map<string, string>;
}

/** Mirror of the runtime key serialization in @relocator/playwright keys.ts. */
function canonicalizeArg(node: Node): string | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return JSON.stringify(node.getLiteralValue());
  }
  if (Node.isNumericLiteral(node)) return JSON.stringify(node.getLiteralValue());
  if (node.getKind() === SyntaxKind.TrueKeyword) return 'true';
  if (node.getKind() === SyntaxKind.FalseKeyword) return 'false';
  if (Node.isRegularExpressionLiteral(node)) return node.getText();
  if (Node.isObjectLiteralExpression(node)) {
    const entries: Array<[string, string]> = [];
    for (const prop of node.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) return null;
      const nameNode = prop.getNameNode();
      const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : prop.getName();
      const value = canonicalizeArg(prop.getInitializerOrThrow());
      if (value === null) return null;
      entries.push([name, value]);
    }
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`;
  }
  return null;
}

function canonicalizeCall(call: CallExpression): string | null {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const args = call.getArguments().map(canonicalizeArg);
  if (args.some((a) => a === null)) return null;
  return `${expr.getName()}(${args.join(',')})`;
}

function findMatchingCall(
  source: SourceFile,
  proposal: PatchProposal,
): CallExpression | null {
  const matches = source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => canonicalizeCall(call) === proposal.originalLocator)
    .filter((call) => Math.abs(call.getStartLineNumber() - proposal.callsite.line) <= 1);
  if (matches.length === 0) return null;
  // Closest column wins when the same locator appears twice on a line.
  matches.sort(
    (a, b) =>
      Math.abs(a.getStart() - a.getStartLinePos() - proposal.callsite.column) -
      Math.abs(b.getStart() - b.getStartLinePos() - proposal.callsite.column),
  );
  return matches[0]!;
}

export function applyProposals(
  proposals: readonly PatchProposal[],
  options: { project?: Project; write?: boolean } = {},
): CodemodResult {
  const project = options.project ?? new Project();
  const edits: FileEdit[] = [];
  const warnings: PatchWarning[] = [];
  const changedFiles = new Map<string, string>();

  const byFile = new Map<string, PatchProposal[]>();
  for (const proposal of proposals) {
    if (proposal.originalLocator.includes(').')) {
      warnings.push({
        callsite: proposal.callsite,
        originalLocator: proposal.originalLocator,
        reason: 'chained locators are not auto-patched yet — update manually',
      });
      continue;
    }
    const list = byFile.get(proposal.callsite.file);
    if (list) list.push(proposal);
    else byFile.set(proposal.callsite.file, [proposal]);
  }

  for (const [file, fileProposals] of byFile) {
    let source: SourceFile;
    try {
      source = project.getSourceFile(file) ?? project.addSourceFileAtPath(file);
    } catch {
      for (const p of fileProposals) {
        warnings.push({
          callsite: p.callsite,
          originalLocator: p.originalLocator,
          reason: `source file not found: ${file}`,
        });
      }
      continue;
    }

    // Bottom-up so earlier replacements don't shift later positions.
    const ordered = [...fileProposals].sort((a, b) => b.callsite.line - a.callsite.line);
    let touched = false;
    for (const proposal of ordered) {
      const call = findMatchingCall(source, proposal);
      if (!call) {
        warnings.push({
          callsite: proposal.callsite,
          originalLocator: proposal.originalLocator,
          reason: 'could not find a matching locator call at the callsite (source changed since the run?)',
        });
        continue;
      }
      const receiver = (call.getExpression() as import('ts-morph').PropertyAccessExpression)
        .getExpression()
        .getText();
      const line = call.getStartLineNumber();
      const before = source.getFullText().split('\n')[line - 1] ?? '';
      call.replaceWithText(`${receiver}.${proposal.adoptedLocator}`);
      const after = source.getFullText().split('\n')[line - 1] ?? '';
      edits.push({ file, line, before, after, proposal });
      touched = true;
    }
    if (touched) {
      changedFiles.set(file, source.getFullText());
      if (options.write) source.saveSync();
    }
  }

  edits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return { edits, warnings, changedFiles };
}
