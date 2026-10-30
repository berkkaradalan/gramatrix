import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import { secretName } from '@shared/rpc'
import type { ModelRef } from '@shared/types'
import type { HostContext } from '../context'
import { providerEntry } from './catalog'

export type ModelResolver = (ref: ModelRef) => Promise<LanguageModel>

/** Sends every provider to one OpenAI compatible server. Used by end to end tests. */
export const BASE_URL_OVERRIDE_VARIABLE = 'GRAMATRIX_PROVIDER_BASE_URL'

export function createModelResolver(
  context: Pick<HostContext, 'getSecret'>,
  env: Record<string, string | undefined> = process.env
): ModelResolver {
  return async ({ provider, model }) => {
    const entry = providerEntry(provider)
    const apiKey = await context.getSecret(secretName.provider(provider))
    if (!apiKey) throw new Error(`No API key is set for ${entry.label}.`)

    const override = env[BASE_URL_OVERRIDE_VARIABLE]
    if (override)
      return createOpenAICompatible({ name: provider, baseURL: override, apiKey })(model)

    switch (entry.transport) {
      case 'anthropic':
        return createAnthropic({ apiKey })(model)
      case 'anthropic-compatible':
        return createAnthropic({ apiKey, baseURL: entry.baseUrl })(model)
      case 'openai':
        return createOpenAI({ apiKey })(model)
      case 'openrouter':
        // Asks OpenRouter to report what each step actually cost.
        return createOpenRouter({ apiKey })(model, { usage: { include: true } })
      case 'openai-compatible':
        return createOpenAICompatible({
          name: provider,
          baseURL: entry.baseUrl,
          apiKey,
          // Streams leave out token counts unless they are asked for.
          includeUsage: true
        })(model)
    }
  }
}
