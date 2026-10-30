# Providers

Gramatrix works with your own API keys. Keys are entered during onboarding or in settings, and
they are encrypted by the operating system keychain. The renderer can never read a key back.

Consumer subscriptions such as Claude Pro or ChatGPT Plus cannot be used. Anthropic does not allow
third party apps to offer Claude.ai login. Coding plans are different: their vendors issue API keys
for use in coding tools, and they have their own entries.

## Entries

An entry is a key and an endpoint. Each provider below is a separate entry, even when two share a
vendor, because plan keys and pay as you go keys are not interchangeable.

| Id                    | Kind | Transport              | Base URL                                        |
| --------------------- | ---- | ---------------------- | ----------------------------------------------- |
| `anthropic`           | api  | `anthropic`            | `https://api.anthropic.com/v1`                  |
| `openai`              | api  | `openai`               | `https://api.openai.com/v1`                     |
| `openrouter`          | api  | `openrouter`           | `https://openrouter.ai/api/v1`                  |
| `zai`                 | api  | `openai-compatible`    | `https://api.z.ai/api/paas/v4`                  |
| `minimax`             | api  | `anthropic-compatible` | `https://api.minimax.io/anthropic/v1`           |
| `zai-coding-plan`     | plan | `openai-compatible`    | `https://api.z.ai/api/coding/paas/v4`           |
| `zhipu-coding-plan`   | plan | `openai-compatible`    | `https://open.bigmodel.cn/api/coding/paas/v4`   |
| `minimax-coding-plan` | plan | `anthropic-compatible` | `https://api.minimax.io/anthropic/v1`           |
| `kimi-coding-plan`    | plan | `openai-compatible`    | `https://api.kimi.ai/coding/v1`                 |
| `alibaba-coding-plan` | plan | `openai-compatible`    | `https://coding-intl.dashscope.aliyuncs.com/v1` |

`openai` uses the OpenAI client with the Responses API. The `-compatible` transports use the
OpenAI compatible client and the Anthropic client, pointed at the base URL of the entry.

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

Everything in `details` passes through `scrubSecrets`, which removes the stored key and anything
shaped like a key, including the partly masked keys some providers echo back. It can also remove
a long request id, which is the safe side to be wrong on.

Runs that fail use the same explanations as `error`.

| Code or status           | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| Z.ai 401, 1000-1003      | Key rejected. An unknown key gets 401, a key from the other site 1000.   |
| Z.ai 1113, plan          | A Standard key first, then an inactive plan or a model outside the plan. |
| Z.ai 1113, pay as you go | No balance.                                                              |
| Z.ai 1211                | Unknown model.                                                           |
| Z.ai 1302                | Rate limit.                                                              |
| Z.ai 1305                | Overloaded.                                                              |
| Z.ai 1308, 1310          | Usage limit, with the reset time from the provider.                      |
| 401, 402, 403, 404, 429  | Handled the same way for every provider.                                 |

Do not treat a model list as proof that a key works: the Alibaba list answers without a valid key.

## Model lists

There are no hardcoded model lists. `providers.models` builds each list in this order and reports
where it came from in `source`.

1. **`live`:** the provider itself.
   - OpenRouter: the public list, which needs no key. Only models with `tools` in
     `supported_parameters` are kept. Its prices are per token and are converted to per million.
   - Anthropic style (`anthropic`, `minimax`, `minimax-coding-plan`): `GET /models` with `x-api-key`.
   - OpenAI style (all others): `GET /models` with a bearer token. Models that cannot chat, such as
     embedding and audio models, are removed from the OpenAI list by name.
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

The list endpoints were probed with an invalid key: each answers 401 except Alibaba, which answers 200. On 2026-10-30 a made up key was also sent through `providers.test` for every entry that
existed, and each reached the expected endpoint and answered 401. No valid key has been used, so a
real key and `providers.test` remain the proof for an account.

Compatible servers are asked for `stream_options.include_usage`, because streams leave out token
counts otherwise. OpenRouter is asked for usage accounting so it reports the cost of each call.
See [usage](usage.md).

## Adding a provider

1. Add the id to `PROVIDER_IDS` in `src/shared/types.ts`.
2. Add its entry to `PROVIDERS` in `src/host/providers/catalog.ts`.
3. Add its `modelsDevId` to `scripts/update-model-snapshot.mjs` and run `npm run update:models`.
4. Add its logo to the renderer assets.
5. Record the sources in the table above.

## Testing against a fake server

Set `GRAMATRIX_PROVIDER_BASE_URL` to send every provider to one OpenAI compatible server through
the OpenAI compatible client. This also covers the model list, which uses `GET /models` on that
server, and it keeps models.dev out of the picture, so nothing reaches the network. A key must
still be stored, but it can be any value. `src/host/providers/compatible-server.test.ts` shows a
minimal server.
