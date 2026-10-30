# Agent runtime

The agent runs in the host process, under `src/host/agent/`. It is built on `ToolLoopAgent` from
the AI SDK.

## Life of a run

1. `agent.send` reserves the chat, because each chat can have one active run. It returns a run id
   right away.
2. The user message is stored. A chat still called `New chat` is named after the first line.
3. The model conversation is rebuilt from stored messages by `toModelMessages`.
4. `RunRecorder` turns the stream into `run.event` events and saves the assistant message whenever
   a tool changes state and after each step.
5. The run ends with a `finished`, `cancelled` or `failed` event. Nothing is emitted after it. A
   killed command can settle later, and that outcome is only saved, because a late event would
   make the interface show the run as active again.

A missing key or a provider error appears as a `failed` event. The user message stays stored.

`runHeadless` is the same run without a person watching. Schedules and channels use it through the
`AgentRunner` interface. It resolves with the final answer and rejects on failure or cancellation.

## General chats

A chat with a null `projectId` is a general chat. It has no folder, so it has no tools at all:
no file tools, no commands and no subagents. Its instructions say so and tell the model it can
suggest opening a project. Tools are only built in `projectAgentSetup`, so the permission check
cannot be reached from a general chat. Its stored permission mode has no effect. A channel without
a project creates general chats. Jobs always belong to a project.

## Tools

| Tool             | Risk      | Purpose                                   |
| ---------------- | --------- | ----------------------------------------- |
| `read_file`      | `read`    | Read a text file, cut off at 256 KB       |
| `list_dir`       | `read`    | List a directory                          |
| `search_files`   | `read`    | Literal search through project text files |
| `spawn_subagent` | `read`    | Delegate a task. See below.               |
| `write_file`     | `write`   | Create or replace a file                  |
| `edit_file`      | `write`   | Replace an exact string                   |
| `run_command`    | `execute` | Run a shell command in the project root   |

Tools return plain text. A tool that fails returns `Error: ...` so the model can react to it.
File tools refuse anything that is not a regular file, because opening a FIFO blocks and cannot be
cancelled.

To add a tool, write it with `defineTool` in `tools.ts` and add it to `BASE_TOOLS`. The risk level
decides how the permission check treats it.

## Project boundary

`resolveInProject` keeps file tools inside the project root. It rejects `..` escapes, absolute
paths outside the root, symlinks that lead outside (also through a parent directory) and dangling
symlinks that a write would follow.

Write tools also refuse any path with a `.git` segment, in any letter case, checked on both the
requested and the real path. Settings such as `core.fsmonitor` in `.git/config` run commands, so a
write there would turn the `write` permission into `execute`. Other project files that run when
someone uses them, such as `package.json` scripts, are not blocked: they need a person or an
approved command to run them, and they show up in review.

**`run_command` is not sandboxed.** It starts in the project root but can reach anything the user
can. This is why it needs the highest permission level. The boundary checks also run just before
the file operation, so another process changing a link in that instant is not covered.

## Permissions

| Mode           | Read  | Write | Execute |
| -------------- | ----- | ----- | ------- |
| `read-only`    | allow | deny  | deny    |
| `ask`          | allow | ask   | ask     |
| `accept-edits` | allow | allow | ask     |
| `full-access`  | allow | allow | allow   |

The mode is read from the chat for every tool call, so changing it applies to a run in progress,
including its subagents. It is checked again after an approval, in case it dropped while the prompt
was open. The `permissionMode` given to `runHeadless` is a limit: the run uses the lower of that
value and the mode stored on the chat, never a higher one.

The check is in `runGuarded` in `run-tools.ts`, inside tool execution. The SDK approval flow is
not used because subagent tools cannot use it. Doing the check ourselves gives parents and
subagents the same behavior.

When the answer is `ask`, an interactive run emits `approval-requested` and waits for
`agent.resolveApproval`. A headless run has nobody to ask, so it denies the action. A denied call
returns a message to the model, and the run continues.

## Commands

Each command runs in its own process group with `GRAMATRIX_COMMAND` in its environment.
`CommandRegistry` in `commands.ts` tracks them.

- Cancelling a run or hitting the timeout kills the group of that command. Processes that left the
  group with `setsid` are found by the variable, using `ps`.
- A command finishes when its shell exits, plus 200 ms for remaining output. It does not wait for
  background processes that hold the output pipe open.
- Background processes keep running after their command finishes, so a dev server can be started.
  `AgentService.stop` kills them all with SIGKILL when the app quits and waits up to one second.
- Removing a chat or project cancels its run: open approvals are refused, the command is killed
  and the run ends. Saves that arrive after the chat is gone are dropped.

A process that clears its own environment and calls `setsid` cannot be found. The `ps` environment
listing has only been tested on Linux. If macOS hides it, process groups are still killed.

## Subagents

The model can start a subagent with `spawn_subagent`, giving it a name, instructions, a task and
optionally `allowedTools`.

- It starts with an empty context. It does not see the conversation and has to be told everything.
- Without `allowedTools` it gets only read tools.
- `allowedTools` must be a subset of the tools of the parent, so access can never grow.
- Its calls go through the same permission check as the run that started it.
- Nesting stops at depth two. A subagent at depth two has no `spawn_subagent`.
- Cancelling the run cancels every subagent.
- Only its final text returns to the parent. Its tool calls are stored with a `subagentId` so the
  interface can show them, but they are left out of the conversation sent to the model.
