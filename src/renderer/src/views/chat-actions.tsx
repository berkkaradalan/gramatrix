import { useEffect, useState, type ReactNode } from 'react'
import type { Chat } from '@shared/types'
import { Button, Dialog, Field } from '../components/ui'
import { invoke, useAction } from '../state/hooks'
import { useNavigation } from '../state/navigation'
import { useOverlays } from '../state/overlays'

function RenameDialog({
  chat,
  open,
  onOpenChange
}: {
  chat: Chat
  open: boolean
  onOpenChange(open: boolean): void
}): ReactNode {
  const [title, setTitle] = useState(chat.title)
  const { busy, run } = useAction()

  useEffect(() => {
    if (open) setTitle(chat.title)
  }, [open, chat.title])

  const save = (): void => {
    const trimmed = title.trim()
    if (!trimmed) return
    void run(async () => {
      await invoke('chats.update', { id: chat.id, title: trimmed })
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Rename chat">
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <Field label="Title">
          {(id) => (
            <input
              id={id}
              className="input"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>
        <div className="row row-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !title.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export function useChatActions(chat: Chat): {
  rename(): void
  remove(): void
  dialog: ReactNode
} {
  const { confirm } = useOverlays()
  const { route, navigate } = useNavigation()
  const { run } = useAction()
  const [renaming, setRenaming] = useState(false)

  return {
    rename: () => setRenaming(true),
    remove: () => {
      void confirm({
        title: 'Delete this chat?',
        body: `"${chat.title}" and its messages are deleted. This cannot be undone.`,
        action: 'Delete chat'
      }).then((confirmed) => {
        if (!confirmed) return
        void run(async () => {
          await invoke('chats.remove', { id: chat.id })
          if (route.view === 'chat' && route.chatId === chat.id) {
            navigate({ view: 'home', projectId: chat.projectId })
          }
        })
      })
    },
    dialog: <RenameDialog chat={chat} open={renaming} onOpenChange={setRenaming} />
  }
}
