import { Ellipsis, FolderOpen, MessageCircle, Pencil, Plug, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Chat, ChatMessage, ModelRef, PermissionMode } from '@shared/types'
import { ApprovalCard } from '../components/chat/ApprovalCard'
import { MessageParts } from '../components/chat/MessageParts'
import { Composer } from '../components/Composer'
import { ChatUsage } from '../components/usage/ChatUsage'
import { ModelPicker } from '../components/ModelPicker'
import { PermissionControl } from '../components/PermissionControl'
import { Banner, Button, CopyButton, IconButton, Menu, Skeleton } from '../components/ui'
import { isTerminal } from '../lib/run-reducer'
import { useChatActions } from './chat-actions'
import { useApp } from '../state/app-context'
import { invoke, useAction, useQuery } from '../state/hooks'
import { useOverlays } from '../state/overlays'
import { runStore, useRun } from '../state/run-store'

/** Distance from the bottom that still counts as following the conversation. */
const FOLLOW_THRESHOLD_PX = 80

function messageText(message: ChatMessage): string {
  return message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n')
}

function ChatHeader({ chat }: { chat: Chat }): ReactNode {
  const { projects } = useApp()
  const project = projects.find(({ id }) => id === chat.projectId)
  const { rename, remove, dialog } = useChatActions(chat)
  const ProjectIcon = project ? FolderOpen : MessageCircle

  return (
    <header className="chat-header">
      <h1 title={chat.title}>{chat.title}</h1>
      <span className="project-tag" title={project?.path}>
        <ProjectIcon size={13} aria-hidden />
        {project?.name ?? 'No project'}
      </span>
      <span className="spacer" />
      <ChatUsage chatId={chat.id} />
      <Menu
        actions={[
          { label: 'Rename', icon: Pencil, onSelect: rename },
          { label: 'Delete chat', icon: Trash2, danger: true, onSelect: remove }
        ]}
      >
        <IconButton icon={Ellipsis} label="Chat actions" />
      </Menu>
      {dialog}
    </header>
  )
}

function MessageView({ message }: { message: ChatMessage }): ReactNode {
  const text = messageText(message)
  return (
    <article className={`message message-${message.role}`}>
      <div className="message-body">
        <MessageParts parts={message.parts} />
      </div>
      {text && (
        <div className="message-actions">
          <CopyButton text={text} label="Copy message" />
        </div>
      )}
    </article>
  )
}

export function ChatScreen({ chat }: { chat: Chat }): ReactNode {
  const { providers, rememberModel } = useApp()
  const { openProviders } = useOverlays()
  const run = useRun(chat.id)
  const messages = useQuery(() => invoke('chats.messages', { chatId: chat.id }), [chat.id])
  const { run: act } = useAction()
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const running = run.status === 'running'
  const provider = providers.find(({ id }) => id === chat.model.provider)
  const providerReady = provider?.configured === true

  useEffect(() => {
    following.current = true
    invoke('agent.pendingApprovals', { chatId: chat.id }).then(
      (approvals) => runStore.seedApprovals(chat.id, approvals),
      () => undefined
    )
  }, [chat.id])

  // The host saves the user message just before it announces the run.
  useEffect(() => {
    if (run.runId) void messages.reload()
  }, [run.runId])

  // When a run ends the saved messages become the source of truth.
  useEffect(() => {
    if (!isTerminal(run.status)) return
    void messages.reload().then(() => runStore.settle(chat.id))
  }, [run.status, chat.id])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element && following.current) element.scrollTop = element.scrollHeight
  })

  const send = (): void => {
    const text = draft.trim()
    if (!text || running) return
    setDraft('')
    following.current = true
    runStore.clearError(chat.id)
    rememberModel(chat.model)
    void act(() => invoke('agent.send', { chatId: chat.id, text }))
  }

  const retry = (): void => {
    following.current = true
    runStore.clearError(chat.id)
    void act(() => invoke('agent.retry', { chatId: chat.id }))
  }

  const updateChat = (patch: {
    model?: ModelRef
    permissionMode?: PermissionMode
  }): Promise<unknown> => act(() => invoke('chats.update', { id: chat.id, ...patch }))

  const loaded = (messages.data ?? []).filter((message) => message.id !== run.messageId)
  const showLive = running || run.parts.length > 0

  return (
    <div className="chat">
      <ChatHeader chat={chat} />

      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight
          following.current = distance < FOLLOW_THRESHOLD_PX
        }}
      >
        <div className="chat-column" role="log" aria-live="polite" aria-busy={running}>
          {messages.loading && !messages.data && <Skeleton rows={4} />}
          {messages.error && (
            <Banner
              tone="error"
              action={<Button onClick={() => void messages.reload()}>Try again</Button>}
            >
              Could not load this chat: {messages.error}
            </Banner>
          )}

          {loaded.map((message) => (
            <MessageView key={message.id} message={message} />
          ))}

          {showLive && (
            <article className="message message-assistant">
              <div className="message-body">
                <MessageParts parts={run.parts} subagents={run.subagents} />
                {running && run.parts.length === 0 && <p className="working">Working</p>}
              </div>
            </article>
          )}

          {run.approvals.map((request) => (
            <ApprovalCard key={request.id} request={request} />
          ))}

          {run.status === 'failed' && (
            <Banner tone="error" action={<Button onClick={retry}>Retry</Button>}>
              {run.error ?? 'The run failed.'}
            </Banner>
          )}
        </div>
      </div>

      <footer className="composer-area">
        <div className="composer-column">
          {!providerReady && (
            <Banner
              tone="warning"
              action={
                <Button icon={Plug} onClick={() => openProviders(chat.model.provider)}>
                  Connect
                </Button>
              }
            >
              {provider?.label ?? 'This provider'} is not connected.
            </Banner>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            canSend={Boolean(draft.trim())}
            placeholder="Reply"
            autoFocus
            running={running}
            onStop={() => void act(() => invoke('agent.cancel', { chatId: chat.id }))}
          >
            <ModelPicker value={chat.model} onChange={(model) => void updateChat({ model })} />
            {chat.projectId && (
              <PermissionControl
                compact
                value={chat.permissionMode}
                onChange={(permissionMode) => void updateChat({ permissionMode })}
              />
            )}
          </Composer>
        </div>
      </footer>
    </div>
  )
}
