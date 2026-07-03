/**
 * Parser for the SimiloLLM replication dataset (old.txt / new.txt / oracles.txt).
 * Format: ';'-separated, first line is the header, ' || ' joins VON-merged
 * values. Matches the reference CSVReader semantics: values are trimmed,
 * empty or "null" values become absent, and neighbor_text commas are
 * replaced with spaces.
 */

import { readFileSync } from 'node:fs';
import type { WidgetProps } from '@relocator/core';

export interface DatasetWidget {
  app: string;
  props: WidgetProps;
}

export interface Oracle {
  app: string;
  name: string;
  fromXPath: string;
  toXPath: string;
}

function parseLines(path: string): { header: string[]; rows: string[][] } {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]!.split(';').map((v) => v.trim());
  const rows = lines.slice(1).map((line) => line.split(';').map((v) => v.trim()));
  return { header, rows };
}

export function parseWidgets(path: string): DatasetWidget[] {
  const { header, rows } = parseLines(path);
  return rows.map((fields) => {
    const props: WidgetProps = {};
    let app = '';
    header.forEach((key, i) => {
      let value = fields[i] ?? '';
      if (key === 'app') {
        app = value;
        return;
      }
      if (value.length === 0 || value.toLowerCase() === 'null') return;
      if (key === 'neighbor_text') value = value.replaceAll(',', ' ');
      props[key] = value;
    });
    return { app, props };
  });
}

export function parseOracles(path: string): Oracle[] {
  const { rows } = parseLines(path);
  return rows.map((fields) => ({
    app: fields[0] ?? '',
    name: fields[1] ?? '',
    fromXPath: fields[2] ?? '',
    toXPath: fields[3] ?? '',
  }));
}

/** Reference containsParameterValue: ' || '-split, case-insensitive match. */
export function xpathListContains(joined: string | undefined, xpath: string): boolean {
  if (joined === undefined) return false;
  return joined
    .split(' || ')
    .some((v) => v.toLowerCase() === xpath.toLowerCase());
}
