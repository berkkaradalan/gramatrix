import { Check, ShieldAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ApprovalRequest } from '@shared/types'
import { formatJson } from '../../lib/format'
import { languageFromPath } from '../../lib/languages'
import { invoke, useAction } from '../../state/hooks'
import { CodeView } from '../code/CodeView'
import { Button } from '../ui'
import { DiffView } from './DiffView'
import { inputString, isEditInput } from './tool-meta'

function approvalTitle(request: ApprovalRequest): string {
  const path = inputString(request.input, 'path')
  switch (request.toolName) {
    case 'run_command':
      return 'Run this command?'
    case 'edit_file':
      return path ? `Edit ${path}?` : 'Apply this edit?'
    case 'write_file':
      return path ? `Write ${path}?` : 'Write this file?'
    default:
      return request.summary
  }
}

function Preview({ request }: { request: ApprovalRequest }): ReactNode {
  const { input } = request
  const language = languageFromPath(inputString(input, 'path')) ?? undefined
  if (isEditInput(input)) {
    return <DiffView before={input.oldText} after={input.newText} language={language} />
  }
  const command = inputString(input, 'command')
  if (command !== undefined) {
    return <CodeView className="approval-preview" code={`$ ${command}`} language="bash" />
  }
  const content = inputString(input, 'content')
  if (content !== undefined) return <DiffView before="" after={content} language={language} />
  return <CodeView className="approval-preview" code={formatJson(input)} language="json" />
}

export function ApprovalCard({ request }: { request: ApprovalRequest }): ReactNode {
  const { busy, run } = useAction()
  const resolve = (approved: boolean): Promise<unknown> =>
    run(() => invoke('agent.resolveApproval', { requestId: request.id, approved }))

  return (
    <section className="approval" aria-label={`Approval needed for ${request.toolName}`}>
      <header>
        <ShieldAlert size={15} aria-hidden />
        <h3>{approvalTitle(request)}</h3>
      </header>
      <Preview request={request} />
      <div className="row">
        <Button variant="primary" icon={Check} disabled={busy} onClick={() => void resolve(true)}>
          Approve
        </Button>
        <Button icon={X} disabled={busy} onClick={() => void resolve(false)}>
          Deny
        </Button>
      </div>
    </section>
  )
}
