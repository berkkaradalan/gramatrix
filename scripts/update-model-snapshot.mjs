#!/usr/bin/env node
// Regenerates src/host/providers/models-snapshot.json, the offline fallback for model pickers.
// The data comes from https://models.dev (MIT license). Run this when the catalog changes.
import { writeFileSync } from 'node:fs'

const SOURCE_URL = 'https://models.dev/api.json'
const OUTPUT_PATH = new URL('../src/host/providers/models-snapshot.json', import.meta.url)

// The modelsDevId of each entry in src/host/providers/catalog.ts.
const PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'zai',
  'minimax',
  'zai-coding-plan',
  'zhipuai-coding-plan',
  'minimax-coding-plan',
  'kimi-code-plan-global',
  'alibaba-coding-plan'
]

/** The repository is ASCII only, and names are the one field that may not be. */
function toAscii(text) {
  return text
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
}

function toSnapshotModel(model) {
  return {
    id: model.id,
    name: toAscii(model.name ?? model.id),
    ...(model.status ? { status: model.status } : {}),
    tool_call: model.tool_call ?? true,
    reasoning: model.reasoning ?? false,
    limit: { context: model.limit?.context },
    cost: {
      input: model.cost?.input,
      output: model.cost?.output,
      cache_read: model.cost?.cache_read
    }
  }
}

const response = await fetch(SOURCE_URL)
if (!response.ok) throw new Error(`${SOURCE_URL} answered ${response.status}.`)
const catalog = await response.json()

const snapshot = {}
for (const provider of PROVIDERS) {
  const models = catalog[provider]?.models
  if (!models) throw new Error(`models.dev has no provider named ${provider}.`)
  const kept = Object.values(models)
    .filter((model) => model.status !== 'deprecated' && /^[\x20-\x7E]+$/.test(model.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  snapshot[provider] = { models: Object.fromEntries(kept.map((m) => [m.id, toSnapshotModel(m)])) }
}

writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 1)}\n`)
console.log(`Wrote ${PROVIDERS.length} providers to ${OUTPUT_PATH.pathname}.`)
