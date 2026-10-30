import { randomUUID } from 'node:crypto'
import type { LanguageModelUsage, ProviderMetadata } from 'ai'
import type {
  Chat,
  ModelInfo,
  ModelRef,
  Project,
  UsageQuery,
  UsageReport,
  UsageRow,
  UsageSource,
  UsageTotals
} from '@shared/types'
import type { HostContext } from '../context'
import { PROVIDERS } from '../providers/catalog'
import type { RpcRouter } from '../rpc-router'

const TOKENS_PER_PRICE_UNIT = 1_000_000
const GENERAL_CHATS_KEY = 'general'
const GENERAL_CHATS_LABEL = 'General chats'

const SOURCE_LABELS: Record<UsageSource, string> = {
  chat: 'Chats',
  job: 'Scheduled jobs',
  channel: 'Channels',
  subagent: 'Subagents'
}

/** What usage needs from a finished model call. */
export interface StepUsage {
  usage: LanguageModelUsage
  providerMetadata?: ProviderMetadata
}

export interface UsageRecord {
  chat: Chat
  project: Project | null
  source: UsageSource
  step: StepUsage
}

export interface UsageRecorder {
  record(input: UsageRecord): Promise<void>
}

export interface UsageDependencies {
  findModel(ref: ModelRef): Promise<ModelInfo | undefined>
}

interface TotalsRow {
  runs: number
  input: number
  output: number
  cached: number
  reasoning: number
  cost: number
  unpriced: number
}

interface GroupRow extends TotalsRow {
  key: string
  label: string | null
}

const TOTALS_COLUMNS = `
  COUNT(*) AS runs,
  COALESCE(SUM(input_tokens), 0) AS input,
  COALESCE(SUM(output_tokens), 0) AS output,
  COALESCE(SUM(cached_input_tokens), 0) AS cached,
  COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
  COALESCE(SUM(cost), 0) AS cost,
  COALESCE(SUM(cost IS NULL), 0) AS unpriced`

/** Rows of a deleted project have no link but keep their label, which sets them apart. */
const PROJECT_KEY = `COALESCE(
  project_id,
  CASE WHEN project_label IS NULL THEN '${GENERAL_CHATS_KEY}' ELSE 'deleted:' || project_label END
)`

function toTotals(row: TotalsRow): UsageTotals {
  return {
    runs: row.runs,
    inputTokens: row.input,
    outputTokens: row.output,
    cachedInputTokens: row.cached,
    reasoningTokens: row.reasoning,
    cost: row.cost,
    unpricedRuns: row.unpriced
  }
}

function emptyRow(key: string): UsageRow {
  return {
    key,
    label: key,
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    cost: 0,
    unpricedRuns: 0
  }
}

/** Only OpenRouter reports what a step cost. */
function reportedCost(metadata: ProviderMetadata | undefined): number | null {
  const usage = metadata?.['openrouter']?.['usage'] as { cost?: unknown } | undefined
  return typeof usage?.cost === 'number' ? usage.cost : null
}

/**
 * Prices a step from the model list. Unknown prices stay null, never zero. Cached tokens are part
 * of the input count, and they are charged at the input price if no cached price is known.
 */
export function estimateCost(
  usage: LanguageModelUsage,
  model: ModelInfo | undefined
): number | null {
  const { inputTokens, outputTokens } = usage
  if (inputTokens === undefined && outputTokens === undefined) return null
  if (!model || model.inputPrice === null || model.outputPrice === null) return null

  const cached = usage.inputTokenDetails?.cacheReadTokens ?? 0
  const uncached = Math.max((inputTokens ?? 0) - cached, 0)
  const cachedPrice = model.cachedInputPrice ?? model.inputPrice
  const total =
    uncached * model.inputPrice + cached * cachedPrice + (outputTokens ?? 0) * model.outputPrice
  return total / TOKENS_PER_PRICE_UNIT
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Every local calendar day that overlaps the range. Works in days, so clock changes are safe. */
function daysBetween(from: number, to: number): string[] {
  const start = new Date(from)
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const days: string[] = []
  while (cursor.getTime() < to) {
    days.push(localDayKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export class UsageService implements UsageRecorder {
  constructor(
    private readonly context: HostContext,
    private readonly dependencies: UsageDependencies
  ) {}

  /** Never rejects, because bookkeeping must not be able to break an agent run. */
  async record({ chat, project, source, step }: UsageRecord): Promise<void> {
    try {
      const model = await this.dependencies.findModel(chat.model).catch(() => undefined)
      const cost = reportedCost(step.providerMetadata) ?? estimateCost(step.usage, model)
      this.insert({ chat, project, source, step }, cost, model?.name ?? chat.model.model)
    } catch (error) {
      console.warn('Could not record usage:', error)
    }
  }

  report(query: UsageQuery): UsageReport {
    return {
      totals: toTotals(this.selectTotals(query)),
      byDay: this.byDay(query),
      byProvider: this.group(query, 'provider', 'NULL').map((row) => ({
        ...row,
        label: PROVIDERS.find(({ id }) => id === row.key)?.label ?? row.key
      })),
      byModel: this.group(query, `provider || ':' || model`, 'MAX(model_label)'),
      byProject: this.group(query, PROJECT_KEY, 'MAX(project_label)').map((row) => ({
        ...row,
        label: row.key === GENERAL_CHATS_KEY ? GENERAL_CHATS_LABEL : row.label
      })),
      bySource: this.group(query, 'source', 'NULL').map((row) => ({
        ...row,
        label: SOURCE_LABELS[row.key as UsageSource] ?? row.key
      }))
    }
  }

  register(router: RpcRouter): void {
    router.handle('usage.report', (query) => this.report(query))
  }

  private insert({ chat, project, source, step }: UsageRecord, cost: number | null, label: string) {
    const { db } = this.context
    // The chat can be deleted while a step is being priced. The row still has to count.
    const chatExists = db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chat.id) !== undefined
    const projectExists =
      project !== null &&
      db.prepare('SELECT 1 FROM projects WHERE id = ?').get(project.id) !== undefined
    const chatId = chatExists ? chat.id : null
    const projectId = projectExists ? project.id : null
    const { usage } = step

    db.prepare(
      `INSERT INTO usage_events
       (id, chat_id, project_id, provider, model, source, input_tokens, output_tokens,
        cached_input_tokens, reasoning_tokens, cost, project_label, model_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      chatId,
      projectId,
      chat.model.provider,
      chat.model.model,
      source,
      usage.inputTokens ?? 0,
      usage.outputTokens ?? 0,
      usage.inputTokenDetails?.cacheReadTokens ?? 0,
      usage.outputTokenDetails?.reasoningTokens ?? 0,
      cost,
      project?.name ?? null,
      label,
      this.context.now()
    )
    this.context.emit('usage.changed', { chatId, projectId })
  }

  private where(query: UsageQuery): { clause: string; values: (string | number)[] } {
    const conditions: string[] = []
    const values: (string | number)[] = []
    const add = (condition: string, value: string | number): void => {
      conditions.push(condition)
      values.push(value)
    }
    if (query.from !== undefined) add('created_at >= ?', query.from)
    if (query.to !== undefined) add('created_at < ?', query.to)
    if (query.chatId !== undefined) add('chat_id = ?', query.chatId)
    if (query.projectId === null) {
      // A deleted project also has no id, but it keeps its label. It was not a general chat.
      conditions.push('project_id IS NULL AND project_label IS NULL')
    } else if (query.projectId !== undefined) {
      add('project_id = ?', query.projectId)
    }
    return {
      clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      values
    }
  }

  private selectTotals(query: UsageQuery): TotalsRow {
    const { clause, values } = this.where(query)
    return this.context.db
      .prepare(`SELECT ${TOTALS_COLUMNS} FROM usage_events ${clause}`)
      .get(...values) as unknown as TotalsRow
  }

  private group(query: UsageQuery, keySql: string, labelSql: string): UsageRow[] {
    const { clause, values } = this.where(query)
    const rows = this.context.db
      .prepare(
        `SELECT ${keySql} AS key, ${labelSql} AS label, ${TOTALS_COLUMNS}
         FROM usage_events ${clause}
         GROUP BY key
         ORDER BY cost DESC, input + output DESC, key`
      )
      .all(...values) as unknown as GroupRow[]
    return rows.map((row) => ({ ...toTotals(row), key: row.key, label: row.label ?? row.key }))
  }

  private byDay(query: UsageQuery): UsageRow[] {
    const { clause, values } = this.where(query)
    const rows = this.context.db
      .prepare(
        `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS key, NULL AS label,
         ${TOTALS_COLUMNS}
         FROM usage_events ${clause}
         GROUP BY key
         ORDER BY key`
      )
      .all(...values) as unknown as GroupRow[]
    const used = new Map(
      rows.map((row) => [row.key, { ...toTotals(row), key: row.key, label: row.key }])
    )
    if (query.from === undefined || query.to === undefined) return [...used.values()]
    return daysBetween(query.from, query.to).map((day) => used.get(day) ?? emptyRow(day))
  }
}
