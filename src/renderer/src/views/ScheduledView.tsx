import {
  CalendarClock,
  Ellipsis,
  FolderOpen,
  FolderPlus,
  History,
  Pencil,
  Play,
  Plus,
  Trash2
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { JobInput } from '@shared/rpc'
import type { Job, JobRun, JobRunStatus, ModelRef, PermissionMode } from '@shared/types'
import { ModelPicker } from '../components/ModelPicker'
import { PermissionControl } from '../components/PermissionControl'
import { addProjectFromDialog } from '../components/ProjectChip'
import { ScheduleBuilder } from '../components/ScheduleBuilder'
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Menu,
  PageHeader,
  Select,
  Skeleton,
  StatusDot,
  Switch
} from '../components/ui'
import { formatDateTime } from '../lib/format'
import { PERMISSION_HINTS } from '../lib/labels'
import {
  DEFAULT_SCHEDULE,
  buildCron,
  describeSchedule,
  parseCron,
  validateCron
} from '../lib/schedule'
import { resolveDefaultModel, useApp } from '../state/app-context'
import { invoke, useAction, useHostEvent, useQuery } from '../state/hooks'
import { useNavigation } from '../state/navigation'
import { useOverlays } from '../state/overlays'
import { toast } from '../state/toasts'

const RUN_STATUS: Record<JobRunStatus, { tone: 'busy' | 'ok' | 'error' | 'off'; label: string }> = {
  running: { tone: 'busy', label: 'Running' },
  succeeded: { tone: 'ok', label: 'Succeeded' },
  failed: { tone: 'error', label: 'Failed' },
  missed: { tone: 'off', label: 'Missed' }
}

function JobDialog({
  open,
  job,
  onOpenChange
}: {
  open: boolean
  job: Job | null
  onOpenChange(open: boolean): void
}): ReactNode {
  const { projects, settings, providers } = useApp()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [projectId, setProjectId] = useState('')
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE)
  const [model, setModel] = useState<ModelRef | null>(null)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('read-only')
  const [catchUp, setCatchUp] = useState(false)
  const { busy, run } = useAction()

  useEffect(() => {
    if (!open) return
    setName(job?.name ?? '')
    setPrompt(job?.prompt ?? '')
    setProjectId(job?.projectId ?? projects[0]?.id ?? '')
    setSchedule(job ? parseCron(job.cron) : DEFAULT_SCHEDULE)
    setModel(job?.model ?? resolveDefaultModel(settings, providers))
    setPermissionMode(job?.permissionMode ?? 'read-only')
    setCatchUp(job?.catchUp ?? false)
    // Only opening resets the form. Later changes to settings must not wipe what was typed.
  }, [open, job])

  const cron = buildCron(schedule)
  const canSave = Boolean(
    name.trim() && prompt.trim() && projectId && model && !validateCron(cron) && !busy
  )

  const save = (): void => {
    if (!canSave || !model) return
    const input: JobInput = {
      projectId,
      name: name.trim(),
      prompt: prompt.trim(),
      cron,
      model,
      permissionMode,
      catchUp,
      enabled: job?.enabled ?? true
    }
    void run(async () => {
      if (job) await invoke('jobs.update', { id: job.id, patch: input })
      else await invoke('jobs.create', input)
      toast.success(job ? 'Job saved.' : 'Job created.')
      onOpenChange(false)
    })
  }

  return (
    <Dialog wide open={open} onOpenChange={onOpenChange} title={job ? 'Edit job' : 'New job'}>
      <form
        className="stack-large"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              className="input"
              autoFocus
              placeholder="Nightly dependency review"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="What should the agent do?">
          {(id) => (
            <textarea
              id={id}
              className="input textarea"
              rows={3}
              placeholder="Check for outdated dependencies and summarize what changed."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          )}
        </Field>
        <Field label="Project" hint="Jobs always run inside a project folder.">
          {(id) => (
            <Select
              id={id}
              value={projectId}
              placeholder="Choose a project"
              options={projects.map((project) => ({
                value: project.id,
                label: project.name,
                hint: project.path
              }))}
              onChange={setProjectId}
            />
          )}
        </Field>
        <ScheduleBuilder draft={schedule} onChange={setSchedule} />
        <div className="grid-two">
          <Field label="Model">
            {(id) => <ModelPicker id={id} block value={model} onChange={setModel} />}
          </Field>
          <Field
            label="Permissions"
            hint={
              permissionMode === 'ask'
                ? 'Nobody can approve during a job, so approvals are denied.'
                : PERMISSION_HINTS[permissionMode]
            }
          >
            {(id) => (
              <PermissionControl id={id} value={permissionMode} onChange={setPermissionMode} />
            )}
          </Field>
        </div>
        <Switch
          label="Catch up on startup"
          hint="Run once when the app opens if a scheduled time was missed."
          checked={catchUp}
          onChange={setCatchUp}
        />
        <div className="row row-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {job ? 'Save changes' : 'Create job'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function RunHistory({ job }: { job: Job }): ReactNode {
  const { navigate } = useNavigation()
  const runs = useQuery(() => invoke('jobs.runs', { jobId: job.id }), [job.id, job.lastRunAt])
  useHostEvent('jobs.changed', () => void runs.reload())

  if (runs.loading && !runs.data) return <Skeleton rows={2} />
  if (runs.error) return <Banner tone="error">{runs.error}</Banner>
  const list: JobRun[] = runs.data ?? []
  if (list.length === 0) return <p className="muted run-empty">This job has not run yet.</p>

  return (
    <ul className="run-list">
      {list.map((run) => {
        const status = RUN_STATUS[run.status]
        return (
          <li key={run.id}>
            <StatusDot tone={status.tone} />
            <span>{status.label}</span>
            <span className="muted">{formatDateTime(run.startedAt)}</span>
            {run.error && <span className="run-error">{run.error}</span>}
            <span className="spacer" />
            {run.chatId && (
              <button
                type="button"
                className="link"
                onClick={() => navigate({ view: 'chat', chatId: run.chatId! })}
              >
                Open transcript
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function JobRow({ job, onEdit }: { job: Job; onEdit(): void }): ReactNode {
  const { projects } = useApp()
  const { confirm } = useOverlays()
  const [showHistory, setShowHistory] = useState(false)
  const { busy, run } = useAction()
  const project = projects.find(({ id }) => id === job.projectId)

  const toggle = (enabled: boolean): Promise<unknown> =>
    run(() => invoke('jobs.update', { id: job.id, patch: { enabled } }))

  const runNow = (): Promise<unknown> =>
    run(async () => {
      await invoke('jobs.runNow', { id: job.id })
      toast.success(`${job.name} started.`)
    })

  const remove = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Delete ${job.name}?`,
      body: 'The schedule and its run history are deleted. Transcripts stay in your chats.',
      action: 'Delete job'
    })
    if (confirmed) await run(() => invoke('jobs.remove', { id: job.id }))
  }

  return (
    <li className="list-row-group">
      <div className="list-row">
        <span className="list-row-icon">
          <CalendarClock size={16} aria-hidden />
        </span>
        <div className="list-row-main">
          <h2>{job.name}</h2>
          <p className="muted">
            {describeSchedule(job.cron)}
            {job.enabled && job.nextRunAt !== null && (
              <>
                <span className="meta-separator" />
                Next {formatDateTime(job.nextRunAt)}
              </>
            )}
          </p>
        </div>
        <span className="project-tag">
          <FolderOpen size={13} aria-hidden />
          {project?.name ?? 'Unknown project'}
        </span>
        <IconButton icon={Play} label="Run now" disabled={busy} onClick={() => void runNow()} />
        <Menu
          actions={[
            { label: 'Edit', icon: Pencil, onSelect: onEdit },
            {
              label: showHistory ? 'Hide history' : 'Show history',
              icon: History,
              onSelect: () => setShowHistory(!showHistory)
            },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => void remove() }
          ]}
        >
          <IconButton icon={Ellipsis} label={`Actions for ${job.name}`} />
        </Menu>
        <span className="list-row-switch">
          <Switch
            label={`Enable ${job.name}`}
            checked={job.enabled}
            disabled={busy}
            onChange={(enabled) => void toggle(enabled)}
          />
        </span>
      </div>
      {showHistory && (
        <div className="list-row-extra">
          <RunHistory job={job} />
        </div>
      )}
    </li>
  )
}

export function ScheduledView(): ReactNode {
  const { projects, settings, reloadProjects } = useApp()
  const jobs = useQuery(() => invoke('jobs.list', undefined), [])
  const [dialog, setDialog] = useState<{ job: Job | null } | null>(null)
  useHostEvent('jobs.changed', () => void jobs.reload())

  const hasProjects = projects.length > 0
  const list = jobs.data ?? []

  return (
    <div className="page">
      <div className="page-column">
        <PageHeader
          title="Scheduled"
          description="Prompts that run on their own, inside a project."
          action={
            hasProjects && (
              <Button variant="primary" icon={Plus} onClick={() => setDialog({ job: null })}>
                New job
              </Button>
            )
          }
        />
        {!settings.closeToTray && list.length > 0 && (
          <Banner tone="warning">
            Jobs only run while Gramatrix is open. Turn on the tray in Settings to keep them going.
          </Banner>
        )}
        {jobs.error && (
          <Banner
            tone="error"
            action={<Button onClick={() => void jobs.reload()}>Try again</Button>}
          >
            Could not load jobs: {jobs.error}
          </Banner>
        )}
        {jobs.loading && !jobs.data && <Skeleton rows={4} />}
        {jobs.data && list.length === 0 && (
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled"
            action={
              hasProjects ? (
                <Button variant="primary" icon={Plus} onClick={() => setDialog({ job: null })}>
                  New job
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={FolderPlus}
                  onClick={() => void addProjectFromDialog(reloadProjects)}
                >
                  Add a project
                </Button>
              )
            }
          >
            {hasProjects
              ? 'Run a prompt on a schedule, such as a nightly code review.'
              : 'Jobs run inside a project, so add one first.'}
          </EmptyState>
        )}
        {list.length > 0 && (
          <ul className="list list-plain">
            {list.map((job) => (
              <JobRow key={job.id} job={job} onEdit={() => setDialog({ job })} />
            ))}
          </ul>
        )}
        {list.length > 0 && (
          <p className="hint">Jobs only run while Gramatrix is running, including in the tray.</p>
        )}
      </div>
      <JobDialog
        open={dialog !== null}
        job={dialog?.job ?? null}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      />
    </div>
  )
}
