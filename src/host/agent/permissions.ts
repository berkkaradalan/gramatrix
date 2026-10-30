import { randomUUID } from 'node:crypto'
import { PERMISSION_MODES, type ApprovalRequest, type PermissionMode } from '@shared/types'

export type ToolRisk = 'read' | 'write' | 'execute'

export type PermissionDecision = 'allow' | 'ask' | 'deny'

const POLICY: Record<PermissionMode, Record<ToolRisk, PermissionDecision>> = {
  'read-only': { read: 'allow', write: 'deny', execute: 'deny' },
  ask: { read: 'allow', write: 'ask', execute: 'ask' },
  'accept-edits': { read: 'allow', write: 'allow', execute: 'ask' },
  'full-access': { read: 'allow', write: 'allow', execute: 'allow' }
}

export function decidePermission(mode: PermissionMode, risk: ToolRisk): PermissionDecision {
  return POLICY[mode][risk]
}

/** The stricter of two modes. `PERMISSION_MODES` is ordered from least to most access. */
export function lowerPermissionMode(a: PermissionMode, b: PermissionMode): PermissionMode {
  return PERMISSION_MODES.indexOf(a) < PERMISSION_MODES.indexOf(b) ? a : b
}

interface PendingApproval {
  request: ApprovalRequest
  settle(approved: boolean): void
}

/** Holds approval requests until the user answers or the run is cancelled. */
export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>()

  /** Resolves false when the signal aborts, so a cancelled run never waits on an answer. */
  request(
    input: Omit<ApprovalRequest, 'id'>,
    signal: AbortSignal,
    onCreated: (request: ApprovalRequest) => void,
    onSettled: (requestId: string) => void
  ): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)
    const request: ApprovalRequest = { ...input, id: randomUUID() }

    return new Promise((resolve) => {
      const settle = (approved: boolean): void => {
        this.pending.delete(request.id)
        signal.removeEventListener('abort', onAbort)
        onSettled(request.id)
        resolve(approved)
      }
      const onAbort = (): void => settle(false)
      signal.addEventListener('abort', onAbort)
      this.pending.set(request.id, { request, settle })
      onCreated(request)
    })
  }

  resolve(requestId: string, approved: boolean): void {
    const pending = this.pending.get(requestId)
    if (!pending) throw new Error('This approval request is no longer active.')
    pending.settle(approved)
  }

  forChat(chatId: string): ApprovalRequest[] {
    return [...this.pending.values()]
      .map((pending) => pending.request)
      .filter((request) => request.chatId === chatId)
  }
}
