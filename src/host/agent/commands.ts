import { execFile, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Set on every command. A process that left its group with `setsid` keeps this variable, which
 * is the only reliable way left to find it. The value is `<registry id>:<command id>`.
 */
export const COMMAND_MARKER_VARIABLE = 'GRAMATRIX_COMMAND'

function killGroup(groupId: number): void {
  try {
    process.kill(-groupId, 'SIGKILL')
  } catch {
    // The process group already exited.
  }
}

function groupExists(groupId: number): boolean {
  try {
    process.kill(-groupId, 0)
    return true
  } catch {
    return false
  }
}

/** Finds process ids in `ps eww -A -o pid=,command=` output, which includes environments. */
export function findMarkedProcesses(psOutput: string, marker: string): number[] {
  const assignment = `${COMMAND_MARKER_VARIABLE}=${marker}`
  return psOutput.split('\n').flatMap((line) => {
    if (!line.includes(assignment)) return []
    const processId = Number.parseInt(line.trim(), 10)
    return Number.isNaN(processId) || processId === process.pid ? [] : [processId]
  })
}

function listProcesses(): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['eww', '-A', '-o', 'pid=,command='],
      { maxBuffer: 64 * 1024 * 1024, timeout: 2000 },
      // Finding escaped processes is best effort. Process groups are still killed without it.
      (_error, stdout) => resolve(stdout ?? '')
    )
  })
}

async function killMarkedProcesses(marker: string): Promise<void> {
  for (const processId of findMarkedProcesses(await listProcesses(), marker)) {
    try {
      process.kill(processId, 'SIGKILL')
    } catch {
      // The process already exited.
    }
  }
}

/** Remembers every command started through it, so none of them can outlive the host. */
export class CommandRegistry {
  private readonly id = randomUUID()
  private readonly groups = new Set<number>()
  private readonly running = new Set<Promise<void>>()

  newMarker(): string {
    return `${this.id}:${randomUUID()}`
  }

  /** The child has to be a process group leader, so spawn it with `detached: true`. */
  track(child: ChildProcess, marker: string): { kill(): void } {
    const groupId = child.pid
    if (groupId === undefined) return { kill: () => {} }

    // A finished group is forgotten so a reused process id can never be killed by mistake.
    // A group with background processes stays until it is empty.
    for (const known of this.groups) if (!groupExists(known)) this.groups.delete(known)
    this.groups.add(groupId)

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    this.running.add(exited)
    void exited.then(() => this.running.delete(exited))

    return {
      kill: () => {
        killGroup(groupId)
        void killMarkedProcesses(marker)
      }
    }
  }

  /** Kills everything tracked and waits for shells to exit, for at most `graceMs`. */
  async killAll(graceMs: number): Promise<void> {
    for (const groupId of this.groups) killGroup(groupId)
    this.groups.clear()
    await killMarkedProcesses(this.id)
    await Promise.race([Promise.all(this.running), delay(graceMs, undefined, { ref: false })])
  }
}
