import type { RpcMethod, RpcParams, RpcResult } from '@shared/rpc'

type Handler<M extends RpcMethod> = (params: RpcParams<M>) => RpcResult<M> | Promise<RpcResult<M>>

/** Maps RPC method names to handlers. Each service registers its own methods. */
export class RpcRouter {
  private readonly handlers = new Map<string, (params: never) => unknown>()

  handle<M extends RpcMethod>(method: M, handler: Handler<M>): void {
    this.handlers.set(method, handler as (params: never) => unknown)
  }

  async dispatch(method: string, params: unknown): Promise<unknown> {
    const handler = this.handlers.get(method)
    if (!handler) throw new Error(`Unknown method: ${method}`)
    return handler(params as never)
  }
}
