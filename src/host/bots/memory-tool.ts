import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { MEMORY_KINDS } from '@shared/types'
import type { RunRecorder } from '../agent/run-recorder'
import type { BotService, MemoryChange } from './bot-service'

export const MEMORY_TOOL_NAME = 'memory'

const inputSchema = z.object({
  action: z.enum(['add', 'replace', 'remove']),
  kind: z.enum(MEMORY_KINDS).describe('"user" for facts about the user, "notes" for the rest'),
  content: z.string().optional().describe('The new entry. Needed for add and replace.'),
  oldText: z
    .string()
    .optional()
    .describe('A unique part of the entry to change. Needed for replace and remove.')
})

function toChange(input: z.infer<typeof inputSchema>): MemoryChange {
  const { action, kind, content, oldText } = input
  if (action !== 'remove' && !content) throw new Error(`${action} needs content.`)
  if (action !== 'add' && !oldText) throw new Error(`${action} needs oldText.`)
  if (action === 'add') return { action, kind, content: content ?? '' }
  if (action === 'replace') return { action, kind, oldText: oldText ?? '', content: content ?? '' }
  return { action, kind, oldText: oldText ?? '' }
}

/**
 * Lets a bot edit its own memory. It changes nothing outside Gramatrix, so it skips the
 * permission check and works in every mode, including in chats without a project.
 *
 * In a chat, `recorder` shows each call in the assistant message. A memory review has nobody
 * watching, so it leaves the recorder out and the calls are not shown anywhere.
 */
export function createMemoryTool(bots: BotService, botId: string, recorder?: RunRecorder): Tool {
  return tool({
    description:
      'Add, replace or remove an entry in your memory. Memory is shown to you at the start of ' +
      'every conversation, so keep entries short and lasting. Changes apply from the next ' +
      'conversation on.',
    inputSchema,
    execute: async (input, { toolCallId }) => {
      recorder?.toolStarted({ toolCallId, toolName: MEMORY_TOOL_NAME, input })
      try {
        const output = bots.changeMemory(botId, toChange(input))
        recorder?.toolUpdated(toolCallId, 'completed', output)
        return output
      } catch (error) {
        const message = `Error: ${error instanceof Error ? error.message : String(error)}`
        recorder?.toolUpdated(toolCallId, 'failed', message)
        return message
      }
    }
  })
}
