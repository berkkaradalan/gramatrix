import { generateText } from 'ai'
import { secretName, type ProviderTestResult } from '@shared/rpc'
import type { ModelInfo, ModelList, ModelRef, ProviderId, ProviderStatus } from '@shared/types'
import type { HostContext } from '../context'
import type { RpcRouter } from '../rpc-router'
import { PROVIDERS, providerEntry } from './catalog'
import { ModelLists } from './model-lists'
import { endpointOf, explainFailure, failureDetails } from './provider-errors'
import {
  BASE_URL_OVERRIDE_VARIABLE,
  createModelResolver,
  type ModelResolver
} from './resolve-model'

export class ProviderService {
  private readonly modelLists: ModelLists

  constructor(
    private readonly context: HostContext,
    private readonly resolveModel: ModelResolver,
    modelLists?: ModelLists
  ) {
    this.modelLists = modelLists ?? new ModelLists(context)
  }

  async list(): Promise<ProviderStatus[]> {
    return Promise.all(
      PROVIDERS.map(async ({ id, label, kind, logo, hint, keyUrl, defaultModel }) => ({
        id,
        label,
        kind,
        logo,
        hint,
        keyUrl,
        defaultModel,
        configured: (await this.context.getSecret(secretName.provider(id))) !== null
      }))
    )
  }

  models(provider: ProviderId, refresh?: boolean): Promise<ModelList> {
    return this.modelLists.list(provider, refresh)
  }

  /** The metadata of one model, used to price what it consumed. */
  async findModel({ provider, model }: ModelRef): Promise<ModelInfo | undefined> {
    const { models } = await this.modelLists.list(provider)
    return models.find(({ id }) => id === model)
  }

  /** Makes the smallest possible request to prove that the key and the model work. */
  async test(
    provider: ProviderId,
    requestedModel?: string,
    candidateKey?: string
  ): Promise<ProviderTestResult> {
    const entry = providerEntry(provider)
    const model = requestedModel ?? entry.defaultModel
    const baseUrl = process.env[BASE_URL_OVERRIDE_VARIABLE] ?? entry.baseUrl
    const resolveModel = candidateKey
      ? createModelResolver({ getSecret: async () => candidateKey })
      : this.resolveModel
    try {
      await generateText({
        model: await resolveModel({ provider, model }),
        prompt: 'Reply with the word ok.',
        maxOutputTokens: 16,
        maxRetries: 0
      })
      return { ok: true, details: { endpoint: endpointOf(baseUrl), model } }
    } catch (error) {
      const key = candidateKey ?? (await this.context.getSecret(secretName.provider(provider)))
      const details = failureDetails(error, baseUrl, model, key)
      // Without a key nothing was sent, and the message already says what is missing.
      const message = key ? explainFailure(provider, details, key) : details.message
      return { ok: false, error: message, details }
    }
  }

  register(router: RpcRouter): void {
    router.handle('providers.list', () => this.list())
    router.handle('providers.models', ({ provider, refresh }) => this.models(provider, refresh))
    router.handle('providers.test', ({ provider, model, key }) => this.test(provider, model, key))
  }
}
