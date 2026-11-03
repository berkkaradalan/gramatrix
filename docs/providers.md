# Providers

Gramatrix works with your own API keys. Keys are entered during onboarding or in settings, and
they are encrypted by the operating system keychain. The renderer can never read a key back.

Consumer subscriptions such as Claude Pro or ChatGPT Plus cannot be used. Anthropic does not allow
third party apps to offer Claude.ai login. Coding plans are different: their vendors issue API keys
for use in coding tools, and they have their own entries.

## Entries

An entry is a key and an endpoint. Each provider below is a separate entry, even when two share a
vendor, because plan keys and pay as you go keys are not interchangeable.

| Id                    | Kind | Transport              | Base URL                                                 |
| --------------------- | ---- | ---------------------- | -------------------------------------------------------- |
| `anthropic`           | api  | `anthropic`            | `https://api.anthropic.com/v1`                           |
| `openai`              | api  | `openai`               | `https://api.openai.com/v1`                              |
| `gemini`              | api  | `google`               | `https://generativelanguage.googleapis.com/v1beta`       |
| `xai`                 | api  | `xai`                  | `https://api.x.ai/v1`                                    |
| `deepseek`            | api  | `deepseek`             | `https://api.deepseek.com`                               |
| `mistral`             | api  | `mistral`              | `https://api.mistral.ai/v1`                              |
| `openrouter`          | api  | `openrouter`           | `https://openrouter.ai/api/v1`                           |
| `zai`                 | api  | `openai-compatible`    | `https://api.z.ai/api/paas/v4`                           |
| `alibaba`             | api  | `openai-compatible`    | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| `minimax`             | api  | `anthropic-compatible` | `https://api.minimax.io/anthropic/v1`                    |
| `zai-coding-plan`     | plan | `openai-compatible`    | `https://api.z.ai/api/coding/paas/v4`                    |
| `zhipu-coding-plan`   | plan | `openai-compatible`    | `https://open.bigmodel.cn/api/coding/paas/v4`            |
| `minimax-coding-plan` | plan | `anthropic-compatible` | `https://api.minimax.io/anthropic/v1`                    |
| `kimi-coding-plan`    | plan | `openai-compatible`    | `https://api.kimi.ai/coding/v1`                          |
| `alibaba-coding-plan` | plan | `openai-compatible`    | `https://coding-intl.dashscope.aliyuncs.com/v1`          |

`openai` uses the OpenAI client with the Responses API. The `-compatible` transports use the
OpenAI compatible client and the Anthropic client, pointed at the base URL of the entry. `google`,
`xai`, `deepseek` and `mistral` use the AI SDK package of that provider, because each one handles a
quirk the compatible client does not, listed below. `xai` uses the Responses API and always sends
`store: false`, which teams with zero data retention require.

### Reasoning sent back

Some providers need the reasoning of earlier turns back on later requests. Entries with
`replaysReasoning` get it: `gemini`, `xai`, `deepseek` and `alibaba`. For them every stored text,
reasoning and tool call part keeps the provider data that came with it, such as a signature or
encrypted reasoning, and `toModelMessages` sends it back. Every other entry gets the same history
as before, without reasoning.

- **DeepSeek:** with tools, the reasoning of every earlier turn must be sent back, or the request
  fails with 400. A turn without stored reasoning, such as one from another provider, is sent with
  an empty reasoning field by `@ai-sdk/deepseek`.
- **Gemini 3 and newer:** checks the thought signature of each function call in the current turn.
  `@ai-sdk/google` fills in Google's documented placeholder for a call that has none.
- **xAI:** reasoning comes back encrypted, sometimes with no readable text. It is stored as a
  reasoning part with empty text and is not shown in the chat.
- **Qwen:** thinking is on by default, and newer models need their reasoning back with tools.

Mistral only accepts tool call ids of exactly nine letters and digits. A chat that started with
another provider has other ids, so for `mistral` each id is replaced by a hash of nine characters,
the same every time, so a call and its result still match.

### Pay as you go notes

- **Gemini:** keys come from Google AI Studio. Keys made since May 2026 start with `AQ.`, older ones
  with `AIza`. Google Cloud and Vertex AI credentials do not work, and neither do Google AI Pro or
  Ultra subscriptions. A bad key can answer 400 with reason `API_KEY_INVALID` or 401. There is a
  free tier, but Gemini 4 Argon is not in it. On the free tier Google may use prompts and answers
  to improve its products, and human reviewers may read them. Some countries cannot use the API.
- **xAI:** a team needs prepaid credits before any request works, and a team without them gets 403. A bad key gets 400, not 401. A team admin can limit a key to some models. SuperGrok and X
  subscriptions include no API credit.
- **DeepSeek:** one key kind and one endpoint, billed from a prepaid balance. No balance is 402.
  Its error `code` is almost always `invalid_request_error`, so the HTTP status says more.
- **Mistral:** one key kind for the free plan and paid plans. A bad key gets 401 with a body of
  `{"detail": "..."}`, which `failureDetails` reads.
- **Qwen (`alibaba`):** this entry is the Singapore region. A key only works in the region it was
  made in, and a key from another region gets the same 401 `invalid_api_key` as a wrong key. Coding
  Plan keys start with `sk-sp-` and belong to `alibaba-coding-plan`. New accounts get a free quota
  per model for 90 days.

### Plan notes

- **Z.ai:** since 2026-10-16 there are two kinds of key. A Standard key never uses plan quota, even
  on the coding endpoint. A plan key is created under API Keys, Personal Coding Plan tab, which only
  subscribed accounts see. Team keys come from `https://z.ai/manage-apikey/coding-plan/team/my-plan`.
- **Z.ai plan models:** only GLM-5.3 and GLM-5.3-Flash are allowed, so both GLM plan entries have an
  `allowedModels` list. Every model list source is narrowed to it, and a live list can never add
  to it.
- **Z.ai supported tools:** Z.ai limits the plan to its officially supported tools. Gramatrix uses
  the SDK default identity and never impersonates another tool. On 2026-10-31 a Compatible plan key
  worked through this exact client, for both a short request and a stream with `stream_options`.
  Error 1113 on the plan entry therefore points to the key type first. A Personal Coding Plan key
  has not been tried yet.
- **Zhipu:** the China service has its own accounts. A bigmodel.cn key fails on `api.z.ai` with
  error 1000, so that error on `zai-coding-plan` points to `zhipu-coding-plan`.
- **MiniMax:** plan keys start with `sk-cp-` and only work against plan usage. The MiniMax docs call
  this plan both Token Plan and M Plan.
- **Kimi:** this entry is the international membership on `api.kimi.ai`. Memberships sold on
  `kimi.com` use `api.kimi.com`, which has no entry yet. Kimi treats a changed client identity as
  a violation, so Gramatrix never changes the User-Agent.
- **Alibaba:** this entry is the Singapore region. Plan keys start with `sk-sp-`. Alibaba warns that
  a general key on this URL can be billed pay as you go. The China region uses another URL and has
  no entry yet.

## Testing a key

`providers.test` makes one small model request and returns a `ProviderTestResult`.

- `error` is a plain sentence and the next step. When a key looks like it belongs to a sibling
  entry, it names that entry.
- `details` holds the raw facts for every provider: endpoint host and path, model, HTTP status,
  provider code and message. It is there so a failure can be diagnosed or reported.

The test streams, because some reasoning models refuse requests that do not, and it allows 256
output tokens, because some models always think before they answer.

Everything in `details` passes through `scrubSecrets`, which removes the stored key and anything
shaped like a key, including the partly masked keys some providers echo back. It can also remove
a long request id, which is the safe side to be wrong on.

Runs that fail use the same explanations as `error`.

| Code or status                      | Meaning                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Z.ai 401, 1000-1003                 | Key rejected. An unknown key gets 401, a key from the other site 1000.   |
| Z.ai 1113, plan                     | A Standard key first, then an inactive plan or a model outside the plan. |
| Z.ai 1113, pay as you go            | No balance.                                                              |
| Z.ai 1211                           | Unknown model.                                                           |
| Z.ai 1302                           | Rate limit.                                                              |
| Z.ai 1305                           | Overloaded.                                                              |
| Z.ai 1308, 1310                     | Usage limit, with the reset time from the provider.                      |
| Gemini `API_KEY_INVALID`, 401       | Key rejected. Google Cloud credentials are named as a likely cause.      |
| Gemini `RESOURCE_EXHAUSTED`         | Quota. With `limit: 0`, the model is not in the free tier.               |
| Gemini `PERMISSION_DENIED`          | The key may not use the Gemini API.                                      |
| Gemini `FAILED_PRECONDITION`        | Country or billing.                                                      |
| xAI 400 about the key               | Key rejected.                                                            |
| xAI 403                             | No credits, a spending limit, or a key limited to other models.          |
| Qwen `invalid_api_key`              | Key rejected, or a key from another region.                              |
| Qwen `Arrearage`                    | No balance.                                                              |
| Qwen `AllocationQuota.FreeTierOnly` | The free quota is used up and "Free quota only" is on.                   |
| Qwen `data_inspection_failed`       | Blocked by the content check.                                            |
| 401, 402, 403, 404, 429             | Handled the same way for every provider.                                 |

Do not treat a model list as proof that a key works: the Alibaba Coding Plan list answers without
a valid key, and the Gemini list only checks that a key exists.

## Model lists

There are no hardcoded model lists. `providers.models` builds each list in this order and reports
where it came from in `source`.

1. **`live`:** the provider itself.
   - OpenRouter: the public list, which needs no key. Only models with `tools` in
     `supported_parameters` are kept. Its prices are per token and are converted to per million.
   - Anthropic style (`anthropic`, `minimax`, `minimax-coding-plan`): `GET /models` with `x-api-key`.
   - Gemini: `GET /models` with `x-goog-api-key`, every page, keeping models that support
     `generateContent`. Google answers 200 for any existing key, so this list proves nothing about
     quota or billing.
   - Mistral: `GET /models`, keeping models whose capabilities allow chat and function calling.
   - OpenAI style (all others): `GET /models` with a bearer token. Models that cannot chat, such as
     embedding and audio models, are removed from the OpenAI list by name, and from the Gemini,
     xAI and Qwen lists by the `excludeModels` pattern of their entries.
2. **`catalog`:** models.dev, used when there is no key or the provider call fails or returns
   nothing. Deprecated models are left out.
3. **`snapshot`:** `src/host/providers/models-snapshot.json`, bundled with the app, used when
   models.dev cannot be reached either. A picker is therefore never empty, even offline.

An entry with `allowedModels` only ever offers those models, whatever the source. If a live list
holds none of them, the fallbacks are used instead.

Live lists mostly hold bare ids, so name, context size, prices, tool support and reasoning support
are merged in from models.dev, or from the snapshot if that fails. A model unknown to both is shown
by id and assumed to support tools. Models that are known not to support tools stay listed with
`supportsTools: false`. Plans have no per token price, so their prices are null.

Lists are cached in memory per provider for one hour. `refresh: true` bypasses the cache, and
adding a key also does, because a list made without a key must not hide the live one.

Run `npm run update:models` to regenerate the snapshot.

Model metadata and the provider logos in `src/renderer/src/assets/providers/` come from
[models.dev](https://models.dev), which is MIT licensed. The logos remain the trademarks of their
owners and only identify each provider.

## Where the catalog came from

Checked on 2026-10-30. Update this table whenever the catalog changes.

| Fact                                                 | Source                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Z.ai general URL, `glm-5.3`                          | https://docs.z.ai/guides/overview/quick-start                               |
| Z.ai coding URL, wrong endpoint warning              | https://docs.z.ai/devpack/tool/others                                       |
| Z.ai plan model `glm-5.3`                            | https://docs.z.ai/devpack/overview                                          |
| MiniMax Anthropic list endpoint                      | https://platform.minimax.io/docs/api-reference/models/anthropic/list-models |
| MiniMax key pages, plan keys are not interchangeable | https://platform.minimax.io/docs/token-plan/quickstart                      |
| MiniMax `sk-cp-` prefix                              | MiniMax Token Plan guides, third party copies only                          |
| MiniMax model ids and URLs for both entries          | https://models.dev/api.json                                                 |
| Kimi overseas host `api.kimi.ai`                     | https://www.kimi.com/coding/docs/en/benefits.html                           |
| Kimi URL and models                                  | https://models.dev/api.json, entry `kimi-code-plan-global`                  |
| Kimi model id `kimi-for-coding`                      | https://www.kimi.com/en/help/kimi-code/membership-guide                     |
| Alibaba URL, key page, prefix, `qwen3.7-plus`        | https://www.alibabacloud.com/help/en/model-studio/coding-plan               |
| OpenRouter ids and list format                       | https://openrouter.ai/api/v1/models                                         |
| Claude and OpenAI default models                     | https://models.dev/api.json and the OpenRouter list                         |

Checked on 2026-11-03 for the five entries added then:

| Fact                                            | Source                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek reasoning must be sent back with tools | https://api-docs.deepseek.com/guides/thinking_mode                                                                          |
| DeepSeek error statuses, list endpoint          | https://api-docs.deepseek.com/quick_start/error_codes, https://api-docs.deepseek.com/api/list-models                        |
| Gemini keys and free tier                       | https://ai.google.dev/gemini-api/docs/api-key, https://ai.google.dev/gemini-api/docs/pricing                                |
| Gemini free tier data use                       | https://ai.google.dev/gemini-api/terms                                                                                      |
| Gemini thought signature placeholder            | `@ai-sdk/google` source, `skip_thought_signature_validator`                                                                 |
| Mistral API, error and list formats             | https://docs.mistral.ai/api/, https://docs.mistral.ai/openapi.yaml                                                          |
| Mistral free mode                               | https://docs.mistral.ai/getting-started/quickstart                                                                          |
| xAI API and models                              | https://docs.x.ai/docs/api-reference, https://docs.x.ai/docs/models                                                         |
| Qwen keys, regions and errors                   | https://www.alibabacloud.com/help/en/model-studio/get-api-key, https://www.alibabacloud.com/help/en/model-studio/error-code |
| Qwen compatible mode URL                        | https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope                                    |
| Qwen free quota, 90 days                        | https://www.alibabacloud.com/help/en/model-studio/new-free-quota                                                            |
| Default models of all five                      | https://models.dev/api.json                                                                                                 |

The bodies of a bad key were recorded from the real endpoints with a made up key on 2026-11-03:
Gemini 400 `API_KEY_INVALID`, xAI 400 `invalid-argument`, DeepSeek 401 `authentication_error`,
Mistral 401 `{"detail": "Invalid API Key"}`, Qwen 401 `invalid_api_key`. The tests use these
bodies. No valid key was used for these five, so a real key and `providers.test` remain the proof.

The list endpoints were probed with an invalid key: each answers 401 except Alibaba, which answers 200. On 2026-10-30 a made up key was also sent through `providers.test` for every entry that
existed, and each reached the expected endpoint and answered 401. No valid key has been used, so a
real key and `providers.test` remain the proof for an account.

Compatible servers are asked for `stream_options.include_usage`, because streams leave out token
counts otherwise. OpenRouter is asked for usage accounting so it reports the cost of each call.
See [usage](usage.md).

## Adding a provider

1. Add the id to `PROVIDER_IDS` in `src/shared/types.ts`.
2. Add its entry to `PROVIDERS` in `src/host/providers/catalog.ts`. Prefer the AI SDK package of the
   provider when it handles reasoning, ids or errors the compatible client does not, and add a
   transport in `resolve-model.ts`.
3. Find out whether it needs its reasoning back (`replaysReasoning`) or a tool call id format, and
   how it reports a bad key, no credit and a key from the wrong region. Add explanations to
   `provider-errors.ts` for codes the HTTP status alone does not explain.
4. Add its `modelsDevId` to `scripts/update-model-snapshot.mjs` and run `npm run update:models`.
5. Add its logo to the renderer assets, and its id to `src/main/opencode-keys.ts`.
6. Record the sources in the tables above.

## Testing against a fake server

Set `GRAMATRIX_PROVIDER_BASE_URL` to send every provider to one OpenAI compatible server through
the OpenAI compatible client. This also covers the model list, which uses `GET /models` on that
server, and it keeps models.dev out of the picture, so nothing reaches the network. A key must
still be stored, but it can be any value. `src/host/providers/compatible-server.test.ts` shows a
minimal server.
