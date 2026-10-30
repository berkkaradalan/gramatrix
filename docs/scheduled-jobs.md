# Scheduled jobs

A job sends a fixed prompt to the agent on a schedule, inside one project. Every run gets its own
chat titled `Job: <name>`, so you can read what happened afterwards.

## Creating a job

| Field           | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| Name            | Label shown in the job list.                                            |
| Schedule        | Five field cron in local time: minute, hour, day, month, weekday.       |
| Prompt          | The message sent to the agent.                                          |
| Model           | The model to use.                                                       |
| Permission mode | What the run may do. See below.                                         |
| Catch up        | Run once on launch if a scheduled time passed while the app was closed. |

Examples: `0 9 * * 1-5` runs at 09:00 on weekdays. `*/30 * * * *` runs every 30 minutes.

## Jobs only run while the app is running

Closing the window keeps the app in the tray, and jobs keep running. If you quit the app or the
computer is off, scheduled times pass without a run. On the next launch each job handles this once,
however many times were passed:

- With **catch up** on, the job runs immediately.
- With **catch up** off, the history shows a `missed` entry.

Time a job spent disabled never counts as missed.

## Permissions

Nobody is watching a job, so it cannot ask for approval. Any action that would need one is denied
and the run continues without it. Use `read-only` unless the job needs to change files, and pick
`accept-edits` or `full-access` only for prompts you trust to run unattended.

## Overlapping runs

A job never runs twice at the same time. A scheduled time that arrives during a run is skipped, and
**Run now** reports that the job is already running.

## Removing a project

Removing a project deletes its jobs, stops their timers and cancels any run in progress.

## For developers

- `src/host/scheduler/job-service.ts` owns the schedule, run history and start-up checks.
- `src/host/scheduler/cron.ts` wraps croner. Tests inject a fake `Schedule` to fire ticks by hand.
- `jobs.scheduled_from` is the moment the current schedule took effect. Start-up compares the next
  fire time after the latest of that value, the last run and the latest history row to the clock.
- Runs left in `running` by a crash are marked `failed` on the next start.
- The database cascade cannot see timers, so call `handleProjectRemoved` before deleting a project.
  A tick for a job that no longer exists disarms itself instead of throwing, because croner would
  report a throw as an unhandled rejection.
