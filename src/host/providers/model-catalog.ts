import { z } from 'zod'
import type { ModelInfo, ProviderKind } from '@shared/types'

/** The fields used from models.dev. The bundled snapshot has this same shape. */
const catalogSchema = z.record(
  z.string(),
  z.looseObject({
    models: z.record(
      z.string(),
      z.looseObject({
        id: z.string(),
        name: z.string().optional(),
        status: z.string().optional(),
        tool_call: z.boolean().optional(),
        reasoning: z.boolean().optional(),
        limit: z.looseObject({ context: z.number().optional() }).optional(),
        cost: z
          .looseObject({
            input: z.number().optional(),
            output: z.number().optional(),
            cache_read: z.number().optional()
          })
          .optional()
      })
    )
  })
)

export type ModelCatalog = z.infer<typeof catalogSchema>

export function parseModelCatalog(data: unknown): ModelCatalog | null {
  const parsed = catalogSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** The models of one models.dev provider, without deprecated ones. */
export function catalogModels(
  catalog: ModelCatalog,
  modelsDevId: string,
  kind: ProviderKind
): ModelInfo[] {
  const models = Object.values(catalog[modelsDevId]?.models ?? {})
  return models
    .filter((model) => model.status !== 'deprecated')
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      contextWindow: model.limit?.context ?? null,
      // Plans are listed with a price of zero, which would read as free.
      inputPrice: kind === 'plan' ? null : (model.cost?.input ?? null),
      outputPrice: kind === 'plan' ? null : (model.cost?.output ?? null),
      cachedInputPrice: kind === 'plan' ? null : (model.cost?.cache_read ?? null),
      supportsTools: model.tool_call ?? true,
      supportsReasoning: model.reasoning ?? false
    }))
}
