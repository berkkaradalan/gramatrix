import { APICallError, RetryError } from 'ai'
import type { ProviderTestResult } from '@shared/rpc'
import type { ProviderId } from '@shared/types'
import { providerEntry, wrongEntryHint, type ProviderEntry } from './catalog'

export type FailureDetails = NonNullable<ProviderTestResult['details']>

const MAX_MESSAGE_LENGTH = 500

const GLM_FAMILY: readonly ProviderId[] = ['zai', 'zai-coding-plan', 'zhipu-coding-plan']

/** Anything shaped like a credential. Better to lose a request id than to leak a key. */
const KEY_SHAPED = [
  /\b(?:sk|pk|rk|xai|gsk|key)[-_][A-Za-z0-9_-]{6,}/gi,
  /\bBearer\s+\S+/gi,
  // OpenAI echoes part of a rejected key with the middle masked.
  /\S*\*{3,}\S*/g,
  // Zhipu and Z.ai keys are an id and a secret joined by a dot.
  /\b[A-Za-z0-9]{16,}\.[A-Za-z0-9]{8,}\b/g,
  /\b[A-Za-z0-9_-]{32,}\b/g
]

export function scrubSecrets(text: string, apiKey?: string | null): string {
  const withoutKey = apiKey ? text.replaceAll(apiKey, '[redacted]') : text
  return KEY_SHAPED.reduce((clean, shape) => clean.replace(shape, '[redacted]'), withoutKey)
}

/** Host and path, without a query that could carry a credential. */
export function endpointOf(url: string): string {
  try {
    const { host, pathname } = new URL(url)
    return `${host}${pathname}`
  } catch {
    return 'unknown'
  }
}

function findApiCallError(error: unknown): APICallError | null {
  if (APICallError.isInstance(error)) return error
  if (RetryError.isInstance(error)) return findApiCallError(error.lastError)
  if (error instanceof Error && error.cause) return findApiCallError(error.cause)
  return null
}

interface ErrorBody {
  code?: unknown
  message?: unknown
  /** Mistral sends a string, and a list for validation errors. */
  detail?: unknown
  /** An object for most providers, a plain message for xAI. */
  error?:
    | string
    | {
        code?: unknown
        type?: unknown
        message?: unknown
        /** Google: INVALID_ARGUMENT, PERMISSION_DENIED and the like. */
        status?: unknown
        /** Google: the most specific reason, such as API_KEY_INVALID. */
        details?: { reason?: unknown }[]
      }
}

/**
 * Reads the error bodies of the providers in the catalog: Anthropic, OpenAI and Z.ai style
 * objects, Google's status and reason, xAI's flat code and message, and Mistral's detail.
 */
function parseBody(body: string | undefined): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(body ?? '') as ErrorBody
    const error = typeof parsed.error === 'object' && parsed.error !== null ? parsed.error : {}
    const reason = Array.isArray(error.details)
      ? error.details.find((detail) => typeof detail?.reason === 'string')?.reason
      : undefined
    const code = reason ?? error.status ?? error.code ?? error.type ?? parsed.code
    const message = [
      error.message,
      parsed.error,
      parsed.message,
      typeof parsed.detail === 'string' ? parsed.detail : undefined
    ].find((candidate): candidate is string => typeof candidate === 'string')
    return {
      code: code === undefined || code === null ? undefined : String(code),
      message
    }
  } catch {
    return {}
  }
}

/** The facts of a failure. Nothing in here may contain a key. */
export function failureDetails(
  error: unknown,
  fallbackEndpoint: string,
  model: string,
  apiKey?: string | null
): FailureDetails {
  const apiError = findApiCallError(error)
  const { code, message } = parseBody(apiError?.responseBody)
  const text =
    message ?? apiError?.message ?? (error instanceof Error ? error.message : String(error))
  return {
    endpoint: endpointOf(apiError?.url ?? fallbackEndpoint),
    model,
    status: apiError?.statusCode,
    code: code === undefined ? undefined : scrubSecrets(code, apiKey),
    message: scrubSecrets(text, apiKey).slice(0, MAX_MESSAGE_LENGTH)
  }
}

function explainGlmCode(entry: ProviderEntry, details: FailureDetails): string | null {
  const { code, message } = details
  switch (code) {
    // An unknown key gets 401 here, while 1000 is what a key from the other site gets.
    case '401':
    case '1000':
    case '1001':
    case '1003': {
      const base = `${entry.label} did not accept this key (error ${code}).`
      if (entry.id === 'zai-coding-plan') {
        return (
          `${base} A key from bigmodel.cn does not work on api.z.ai, so add it under ` +
          'Zhipu Coding Plan (China). Otherwise create a new key under API Keys, ' +
          'Personal Coding Plan tab.'
        )
      }
      if (entry.id === 'zhipu-coding-plan') {
        return `${base} A key from z.ai belongs under Z.ai Coding Plan. Otherwise create a new one.`
      }
      return `${base} Check the key, or create a new one.`
    }
    case '1113':
      if (entry.kind === 'plan') {
        return (
          `${entry.label} refused this key with error 1113. This is almost always a Standard ` +
          'key, which never uses plan quota: create one in the Personal Coding Plan tab of API ' +
          `Keys. If it already is a plan key, check that the plan is active and that ` +
          `${details.model} is included. The plan only allows GLM-5.3 and GLM-5.3-Flash.`
        )
      }
      return `${entry.label} reports no balance (error 1113). Top up your account and try again.`
    case '1211':
      return `${entry.label} does not know the model ${details.model} (error 1211). Pick another.`
    case '1302':
      return `${entry.label} rate limit reached (error 1302). Wait a moment and try again.`
    case '1305':
      return `${entry.label} is overloaded right now (error 1305). Try again in a moment.`
    case '1308':
    case '1310':
      return `${entry.label} usage limit reached (error ${code}). ${message ?? ''}`.trim()
    default:
      return null
  }
}

/** Gemini can answer a bad key with 400 or 401, and says more in its reason than its status. */
function explainGeminiCode(entry: ProviderEntry, details: FailureDetails): string | null {
  const { code, status, model, message } = details
  if (code === 'API_KEY_INVALID' || status === 401) {
    return (
      `Google did not accept this key${code ? ` (${code})` : ''}. Create a new one in Google AI ` +
      'Studio. Google Cloud and Vertex AI credentials do not work here.'
    )
  }
  if (code === 'PERMISSION_DENIED') {
    return 'This key may not use the Gemini API. Check its API restrictions in Google AI Studio.'
  }
  if (code === 'RESOURCE_EXHAUSTED') {
    // A free key gets a limit of zero on models that have no free tier.
    return /limit: ?0\b/.test(message ?? '')
      ? `${model} is not part of the free tier. Turn on billing in Google AI Studio, or pick another model.`
      : `${entry.label} quota or rate limit reached. Wait a moment, or check your limits in Google AI Studio.`
  }
  if (code === 'FAILED_PRECONDITION') {
    return (
      'Gemini is not available for this account, often because of the country it is used from ' +
      `or because billing is needed. ${message ?? ''}`.trim()
    )
  }
  return null
}

/** xAI answers a bad key with 400 and a team without credits with 403. */
function explainXaiCode(entry: ProviderEntry, details: FailureDetails): string | null {
  const { status, model, message = '' } = details
  if (status === 400 && /api key/i.test(message)) {
    return `${entry.label} did not accept this key. Check it, or create a new one in the xAI Console.`
  }
  if (status === 403 && /credit/i.test(message)) {
    return (
      'Your xAI team has no credits. Buy credits in the xAI Console. A SuperGrok or X ' +
      'subscription does not include API credits.'
    )
  }
  if ((status === 403 || status === 429) && /spending limit/i.test(message)) {
    return `Your xAI spending limit is reached. Raise it in the xAI Console. ${message}`.trim()
  }
  if (status === 403) {
    return `This xAI key may not use ${model}. A team admin can limit a key to some models.`
  }
  return null
}

/** Alibaba Cloud names its errors, and a key from another region looks just like a bad key. */
function explainAlibabaCode(entry: ProviderEntry, details: FailureDetails): string | null {
  switch (details.code) {
    case 'invalid_api_key':
    case 'InvalidApiKey':
      return (
        `${entry.label} did not accept this key. Keys only work in the region they were made in, ` +
        'and this entry uses Singapore. Create a key there, or check the one you have.'
      )
    case 'Arrearage':
      return 'Your Alibaba Cloud account has no balance. Top it up and try again.'
    case 'AllocationQuota.FreeTierOnly':
      return (
        `The free quota for ${details.model} is used up. Turn off "Free quota only" in Model ` +
        'Studio to pay for more, or pick another model.'
      )
    case 'data_inspection_failed':
      return 'Alibaba Cloud blocked this request in its content check. Rephrase it and try again.'
    case 'access_denied':
      return `This key may not use ${details.model}. Check the model access of your workspace.`
    default:
      return null
  }
}

/** Provider specific explanations, for providers whose codes say more than the HTTP status. */
function explainProviderCode(entry: ProviderEntry, details: FailureDetails): string | null {
  if (GLM_FAMILY.includes(entry.id)) return explainGlmCode(entry, details)
  switch (entry.id) {
    case 'gemini':
      return explainGeminiCode(entry, details)
    case 'xai':
      return explainXaiCode(entry, details)
    case 'alibaba':
      return explainAlibabaCode(entry, details)
    default:
      return null
  }
}

function explainStatus(entry: ProviderEntry, details: FailureDetails): string {
  const { status, model, endpoint } = details
  switch (status) {
    case undefined:
      return `Could not reach ${entry.label}. Check your connection and try again.`
    case 400:
      return `${entry.label} rejected the request. ${details.message ?? ''}`.trim()
    case 401:
      return `${entry.label} did not accept this key. Check it, or create a new one.`
    case 402:
      return `${entry.label} reports no credit on this account. Top it up and try again.`
    case 403:
      return `${entry.label} refused this key for ${model}. Check the access of your account.`
    case 404:
      return `${entry.label} has no ${model} at ${endpoint}. Pick another model.`
    case 429:
      return `${entry.label} rate limit or quota reached. Wait a moment, or check your plan.`
    default:
      return status >= 500
        ? `${entry.label} is having problems (HTTP ${status}). Try again in a moment.`
        : `${entry.label} answered with HTTP ${status}. See the details below.`
  }
}

/** One plain sentence about what went wrong, then the next step. */
export function explainFailure(
  provider: ProviderId,
  details: FailureDetails,
  apiKey?: string | null
): string {
  const entry = providerEntry(provider)
  const explanation = explainProviderCode(entry, details) ?? explainStatus(entry, details)
  // Outages and connection failures say nothing about the key, so no entry advice for those.
  const providerAnswered = details.status !== undefined && details.status < 500
  const hint = apiKey && providerAnswered ? wrongEntryHint(provider, apiKey) : null
  return hint ? `${explanation} ${hint}` : explanation
}
