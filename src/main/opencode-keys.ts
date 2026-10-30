import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderId } from '@shared/types'

/** Our provider ids mapped to the ids opencode files its keys under. */
const OPENCODE_IDS: Record<ProviderId, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
  zai: 'zai',
  minimax: 'minimax',
  'zai-coding-plan': 'zai-coding-plan',
  'zhipu-coding-plan': 'zhipuai-coding-plan',
  'minimax-coding-plan': 'minimax-coding-plan',
  'kimi-coding-plan': 'kimi-code-plan-global',
  'alibaba-coding-plan': 'alibaba-coding-plan'
}

function authFilePath(env: NodeJS.ProcessEnv): string {
  const dataDir = env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share')
  return join(dataDir, 'opencode', 'auth.json')
}

/**
 * Finds the API key an opencode install on this machine holds for a provider.
 * Returns null when opencode is missing, or when it signs in another way, such as OAuth.
 */
export function readOpencodeKey(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  try {
    const auth = JSON.parse(readFileSync(authFilePath(env), 'utf8')) as Record<
      string,
      { type?: string; key?: unknown }
    >
    const entry = auth[OPENCODE_IDS[provider]]
    return entry?.type === 'api' && typeof entry.key === 'string' && entry.key ? entry.key : null
  } catch {
    return null
  }
}
