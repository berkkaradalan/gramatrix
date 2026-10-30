# Usage tracking

Gramatrix records what every model call used, so you can see tokens and cost per day, provider,
model, project and source. The data stays on your computer in `gramatrix.db`.

## What is recorded

`usage_events` has one row per model call. An agent turn with three tool rounds makes four rows.

| Source     | Meaning                                  |
| ---------- | ---------------------------------------- |
| `chat`     | A chat in the app.                       |
| `job`      | A scheduled job.                         |
| `channel`  | A Telegram or Slack conversation.        |
| `subagent` | A subagent, whatever started its parent. |

Rows are written from the SDK callback `onLanguageModelCallEnd`, not from `finish-step`, because
`finish-step` waits for tools. A run cancelled during a long command still counts the call that
started it, and so does a run that fails later. The final run event comes after the rows are
written, so a report made right after it is complete.

A model call cut off while it is streaming is not counted, because a provider reports usage at the
end of the stream. The tokens spent on it stay unknown.

## Deleting chats and projects

Totals survive deletion. `chat_id` and `project_id` are cleared with `ON DELETE SET NULL`, and the
project and model labels are copied into each row. A deleted project stays in reports under its
name. Filtering on a deleted chat finds nothing, because the link is gone, but the rows still count
in the totals.

`project_id` is null for general chats too. The two cases are told apart by `project_label`, which
is null only for general chats, so `projectId: null` never picks up a deleted project.

## Cost

1. A cost reported by the provider wins. Only OpenRouter reports one.
2. Otherwise the cost is tokens times the prices in the [model list](providers.md).
3. Otherwise it is null. A price is never guessed.

Cached input tokens are part of the input count. They are charged at the cached price, or at the
input price if no cached price is known, which is an upper bound. Cache writes have no price of
their own here, so Anthropic style cache writes are charged as normal input and can be undercounted.

Plans have no per token price, so their calls have a null cost and count as `unpricedRuns`. A model
missing from every list does too. `cost` in a report only adds up calls with a known price, so read
it together with `unpricedRuns`.

The price used is the one known when the call was recorded. Later price changes do not rewrite it.

## Reports

`usage.report` takes `from` (inclusive), `to` (exclusive), `chatId` and `projectId`, where a null
`projectId` selects general chats. All numbers are computed in SQL.

The report has `totals`, `byDay`, `byProvider`, `byModel`, `byProject` and `bySource`. Breakdowns
are sorted by cost and then by tokens. `runs` counts model calls.

`byDay` uses local calendar days. When both `from` and `to` are set, days without use are present
as zeros. Otherwise only days with use are listed.

`usage.changed` fires after each recorded call.
