// What the model writes to memory comes back in every later request. A web page or file the agent
// read could plant an instruction there that outlives the chat, so writes are checked for the
// usual signs of that and for secrets. The check is narrow on purpose: a real preference such as
// "always answer in Turkish" must still fit. It catches common attempts, not all of them, which is
// why the memory page shows everything a bot has saved.

const CHECKS: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/,
    reason: 'it contains invisible characters'
  },
  {
    pattern: /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions|rules|guidelines)\b/i,
    reason: 'it tells the agent to drop its instructions'
  },
  { pattern: /\bsystem prompt\b/i, reason: 'it refers to the system prompt' },
  {
    pattern: /\b(without telling|do not tell|don't tell|hide (this|it) from)\b.{0,20}\buser\b/i,
    reason: 'it asks to keep something from the user'
  },
  {
    pattern:
      /\b(send|post|upload|curl|wget)\b.{0,60}\b(api key|token|password|secret|credentials)\b/i,
    reason: 'it asks to send credentials somewhere'
  },
  {
    pattern:
      /\b(sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|xox[abprs]-[a-z0-9-]{10,}|AKIA[0-9A-Z]{16})/i,
    reason: 'it looks like a secret key, and keys never belong in memory'
  }
]

/** Explains why `content` may not be saved to memory, or returns null when it is fine. */
export function memoryWriteProblem(content: string): string | null {
  return CHECKS.find(({ pattern }) => pattern.test(content))?.reason ?? null
}
