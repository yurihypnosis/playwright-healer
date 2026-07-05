/**
 * Ollama provider: fully local, zero-cost Tier 3 for confidential
 * environments (design doc §13). Uses Ollama's structured-output `format`
 * parameter (a JSON schema) so the verdict parses reliably.
 */

import type { DisambiguationInput, DisambiguationResult, LLMProvider } from '@relocator/core';
import { RESULT_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, parseVerdict } from './prompt.js';

export interface OllamaProviderOptions {
  /** Default http://localhost:11434 */
  baseUrl?: string;
  /** e.g. 'llama3.1', 'qwen2.5'. Required — no universally-installed default. */
  model: string;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OllamaProviderOptions) {
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  }

  async disambiguate(input: DisambiguationInput): Promise<DisambiguationResult> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: RESULT_SCHEMA,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input) },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`ollama: HTTP ${response.status} from ${this.baseUrl}/api/chat`);
    }
    const body = (await response.json()) as OllamaChatResponse;
    const verdict = parseVerdict(body.message?.content ?? '{}');
    return {
      ...verdict,
      usage: {
        inputTokens: body.prompt_eval_count ?? 0,
        outputTokens: body.eval_count ?? 0,
      },
    };
  }
}
