/**
 * Anthropic provider for Tier 3 disambiguation. Uses structured outputs
 * (output_config.format with a JSON schema) so the verdict is guaranteed to
 * parse — no retry loop needed. One call per ambiguous heal (§6.4).
 *
 * The default model follows the design doc's policy example: a fast,
 * cost-effective model fits this task (tiny prompt, tiny JSON verdict,
 * <2s latency budget). Override via options.model for higher accuracy.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { DisambiguationInput, DisambiguationResult, LLMProvider } from '@relocator/core';
import { RESULT_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, parseVerdict } from './prompt.js';

export interface AnthropicProviderOptions {
  /** Defaults to ANTHROPIC_API_KEY / `ant auth login` resolution. */
  apiKey?: string;
  /** Default 'claude-haiku-4-5' (design doc §8). */
  model?: string;
  maxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : new Anthropic();
    this.model = options.model ?? 'claude-haiku-4-5';
    this.maxTokens = options.maxTokens ?? 512;
  }

  async disambiguate(input: DisambiguationInput): Promise<DisambiguationResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: RESULT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { chosen: null, confidence: 0, reason: 'provider refused the request' };
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? '';
    const verdict = parseVerdict(text);
    return {
      ...verdict,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
