# Test LLM Model Map

Centralized mapping from abstract keys to real model names for AI plugin tests.

The default source of truth is the **GitHub Actions variable
`TESTS_LLM_MODELS_JSON`** on the `Kong/kong-ee` repository. Per-branch
overrides (e.g. for LTS maintenance branches) are supported — see
[Per-branch overrides](#per-branch-overrides) below.
CI injects the variable into the environment; locally it materializes to
`scripts/test-fixtures/tests_llm_models_json.json` (.gitignored).

Two loaders consume the map:

| Language | File | API |
|----------|------|-----|
| Lua | `spec/helpers/ai/test_models.lua` | `test_models.get(key)`, `test_models.resolve_json(content)`, `test_models.read_fixture(path)`, `test_models.render_fixture(path, overrides)` |
| TypeScript | `spec-ee/kong-api-tests/support/config/test-models.ts` | `getModel(key)` |

Both loaders gracefully degrade: when the map file is unavailable, `get()`/`getModel()` returns the abstract key itself so tests can still load (individual tests requiring real model names will fail).

## How It Works

### In CI

The reusable composite action
`.github/actions/fetch-tests-llm-models/action.yml` runs two steps:

1. Resolve the per-branch variable name from `github.base_ref || github.ref_name`.
2. Inject `TESTS_LLM_MODELS_JSON` (default) and, if defined,
   `TESTS_LLM_MODELS_JSON_LTS` (the per-branch override) into the env, then
   run `scripts/fetch-tests-llm-models.sh` to materialize the JSON file.

Workflows reference it with a single line:

```yaml
- name: Download test LLM model map
  uses: ./.github/actions/fetch-tests-llm-models
```

Used by `build_and_test__busted_tests.yml`, `gateway-api-tests.yml`,
`gateway-api-docker-test-matrix.yml`, and `gateway-api-postgres-test-matrix.yml`.

### Locally

```bash
bash scripts/fetch-tests-llm-models.sh
cat scripts/test-fixtures/tests_llm_models_json.json
```

The fetch script uses `gh variable get TESTS_LLM_MODELS_JSON -R Kong/kong-ee` to
pull the variable value (requires `GITHUB_TOKEN` or `GH_TOKEN` with read access to `Kong/kong-ee`).

## How to Update Model Names Locally

```bash
bash scripts/fetch-tests-llm-models.sh                    # pull latest
$EDITOR scripts/test-fixtures/tests_llm_models_json.json   # edit
# run tests — both Lua and TS loaders read this file
```

## How to Update Model Names in CI

```bash
bash scripts/fetch-tests-llm-models.sh                    # pull latest
$EDITOR scripts/test-fixtures/tests_llm_models_json.json   # edit
bash scripts/push-tests-llm-models.sh                     # push
```

Requires `GITHUB_TOKEN` or `GH_TOKEN` with write access to `Kong/kong-ee`.
All subsequent CI runs pick up the change automatically.

> **Important**: If you rename or remove a key, you must also update all test
> files that reference that key. Grep for the old key across `spec/` and
> `spec-ee/`.

## Key Naming Convention

Keys follow a **model matrix** design: every key locates a cell in the
`provider × capability × size` matrix, with optional qualifiers for
version pinning and deployment variants.

### Format

```
{provider}.{capability}.{size}[:{qualifier}[:{qualifier}...]]
```

All three segments (`provider`, `capability`, `size`) are **required**.
Qualifiers are optional, colon-separated, and may be chained.

### Providers (fixed list)

| Category | Providers |
|----------|-----------|
| Direct API | `openai`, `anthropic`, `gemini`, `mistral`, `cohere`, `deepseek`, `xai`, `dashscope` |
| Platform | `azure`, `azure-anthropic`, `bedrock-anthropic`, `bedrock-amazon`, `bedrock-cohere`, `gemini-vertex` |
| Self-hosted | `huggingface`, `ollama`, `cerebras`, `databricks` |
| Test-only | `test` |

Sub-providers use `-` as separator: `bedrock-anthropic`, not `bedrock.anthropic`.

### Capabilities (fixed list)

Each capability maps to one route type family.

| Capability | Route Type | Description |
|------------|------------|-------------|
| `chat` | `llm/v1/chat`, `llm/v1/completions` | Text generation / conversation |
| `reason` | `llm/v1/chat` | Reasoning models (OpenAI o-series) |
| `embeddings` | `llm/v1/embeddings` | Vector embeddings |
| `image-gen` | `image/v1/images/generations` | Image generation |
| `vision` | `llm/v1/chat` (multimodal) | Image understanding / multimodal input |
| `stt` | `audio/v1/audio/transcriptions` | Speech-to-text |
| `tts` | `audio/v1/audio/speech` | Text-to-speech |
| `audio` | `audio/v1/audio/*` | General audio (preview) |
| `realtime` | `realtime/v1/realtime` | Real-time streaming |
| `rerank` | native rerank | Reranking |
| `video` | video generation | Video generation |
| `mock` | — | Test-only / placeholder models |

### Sizes (fixed list)

| Size | Meaning |
|------|---------|
| `nano` | Smallest / cheapest |
| `small` | Budget-friendly |
| `medium` | Balanced / standard |
| `large` | High-capability |
| `extra-large` | Most powerful (reserved) |

When a provider offers only **one model** for a given capability, use `medium`.

Size reflects relative positioning **within the provider's current lineup**,
not absolute model capability across providers.

### Qualifiers

Qualifiers handle special variants that the `provider.capability.size` triple
alone cannot distinguish — version pins, legacy generations, deployment formats,
model families, etc. They follow a `:` separator after the size segment and may
be chained.

```
openai.chat.small:dated          → gpt-5-mini-2025-08-07   (version-pinned)
anthropic.chat.small:legacy      → claude-3-haiku           (previous generation)
bedrock-anthropic.chat.medium:bare → anthropic.claude-sonnet-4-5-...  (deployment format)
openai.chat.small:4o:dated       → gpt-4o-mini-2024-07-18  (combined qualifiers)
```

Qualifiers are free-form — add new ones as needed. The full list lives in the
model map JSON itself; grep the keys for all currently used qualifiers.

### Model Matrix (current coverage)

| Provider | chat | reason | embeddings | image-gen | vision | stt | tts | audio | realtime | rerank | video |
|----------|------|--------|------------|-----------|--------|-----|-----|-------|----------|--------|-------|
| openai | n s m l | s m l | s l | s l | ✓ | s m | ✓ | ✓ | ✓ | s m | |
| anthropic | s m l | | | | | | | | | | |
| gemini | s m l | | m | | s l | s | | ✓ | | ✓ | |
| mistral | s m l | | m | | ✓ | | | | | | |
| cohere | n m l | | m | | | | | | | ✓ | |
| bedrock-anthropic | s m | | | | | | | | | | |
| bedrock-amazon | s m | | m | ✓ | | | | | | | ✓ |
| bedrock-cohere | m l | | | | | | | | | ✓ | |
| azure | m | | | | | | | | | ✓ | |
| azure-anthropic | m | | | | | | | | | | |
| gemini-vertex | m | | | | | | | | | | |
| huggingface | n s l | | m | | | | | | | | |
| ollama | s m | | | | | | | | | | |
| cerebras | s l | | | | | | | | | | |
| databricks | m | | | | | | | | | | |
| deepseek | m | | | | | | | | | | |
| xai | m | | | | ✓ | | | | | | |
| dashscope | m l | | s m | | | | | | | | |

Sizes: **n**=nano **s**=small **m**=medium **l**=large. A bare ✓ means the capability exists but only at one size (check the JSON for details).

### Examples

```
openai.chat.small                → gpt-5-mini           (current gen, budget)
openai.chat.medium               → gpt-5                (current gen, standard)
openai.chat.large                → gpt-5-pro            (current gen, top)
openai.chat.small:4o             → gpt-4o-mini          (previous gen)
openai.chat.small:4o:dated       → gpt-4o-mini-2024-07-18 (pinned version)
openai.reason.small              → o4-mini              (reasoning, budget)
openai.reason.medium             → o3                   (reasoning, standard)
openai.embeddings.small          → text-embedding-3-small
openai.image-gen.large           → gpt-image-1
anthropic.chat.small             → claude-haiku-4-5      (haiku = small)
anthropic.chat.medium            → claude-sonnet-4-5     (sonnet = medium)
anthropic.chat.large             → claude-opus-4-1       (opus = large)
gemini.chat.small                → gemini-2.5-flash      (flash = small)
gemini.chat.medium               → gemini-2.5-pro        (pro = medium)
gemini.vision.small              → gemini-2.5-flash-image (vision model)
bedrock-anthropic.chat.medium    → us.anthropic.claude-sonnet-4-5-...
bedrock-anthropic.chat.medium:bare → anthropic.claude-sonnet-4-5-...
mistral.chat.medium              → mistral-medium-latest
cohere.chat.medium               → command-r-08-2024
deepseek.chat.medium             → deepseek-chat         (single model = medium)
test.mock.medium                 → try-to-override-the-model
```

## Per-branch overrides

LTS maintenance branches (e.g. `next/3.8.x.x`) can pin specific model names so
they aren't perturbed by master-side updates. Overrides apply **at the key
level**: the per-branch variable contains only the keys that diverge, and the
fetched JSON is `default + LTS_overrides` (LTS keys win on conflict).

This means LTS variables are tiny "diff files" — usually a handful of keys —
and any new key added to the default automatically flows through to LTS
branches with no maintainer action.

### Variable naming

Per-branch overrides live in additional GitHub Actions variables on
`Kong/kong-ee`, named `TESTS_LLM_MODELS_JSON__<SANITIZED_BRANCH>`.

Sanitization: uppercase the branch name, then replace any non-alphanumeric
character with `_`.

| Branch | Override variable |
|---|---|
| `master`, feature branches (no override) | _none — uses `TESTS_LLM_MODELS_JSON` only_ |
| `next/3.8.x.x` | `TESTS_LLM_MODELS_JSON__NEXT_3_8_X_X` |
| `next/3.9.x.x` | `TESTS_LLM_MODELS_JSON__NEXT_3_9_X_X` |

A branch with no matching override variable silently uses the default
unmerged — no behavior change for branches that don't opt in.

### Resolution

The composite action injects two env vars; the fetch script merges:

| Default | LTS override | Result on disk |
|---|---|---|
| set | empty/unset | default as-is |
| set | set | `jq '$default + $lts'` (shallow merge, LTS wins) |
| empty/unset | set | LTS as-is, with a warning |

For PRs the **base branch** drives the lookup (so a PR into `next/3.8.x.x`
uses that LTS env, not the head branch's). The CI log line
`[tests-llm-models] materialized: source=Kong/kong-ee/TESTS_LLM_MODELS_JSON + per-branch override`
confirms when a merge occurred.

`jq` is required when an LTS override is present — already a dependency for
the entry-count summary, available on all GitHub-hosted runners.

### Maintain an LTS override

The local fixture file (`scripts/test-fixtures/tests_llm_models_json.json`)
holds the **merged** result so tests can run. To edit the override, work
from a separate file containing only the diverging keys:

```bash
# Inspect current override (raw, not merged). Empty if not yet created.
gh variable get TESTS_LLM_MODELS_JSON__NEXT_3_8_X_X -R Kong/kong-ee \
  > /tmp/lts-override.json 2>/dev/null || echo '{}' > /tmp/lts-override.json

# Edit only the diverging keys. Example:
# {
#   "openai.chat.medium": "gpt-4o-2024-08-06",
#   "anthropic.chat.medium": "claude-3-5-sonnet-20241022"
# }
$EDITOR /tmp/lts-override.json

# Push back to the per-branch variable.
bash scripts/push-tests-llm-models.sh -f /tmp/lts-override.json -b next/3.8.x.x
```

Bootstrap is implicit — no need to pre-create an empty override. The branch
just uses default until a divergence is needed; only then does the override
variable get created (by the first push above).

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/fetch-tests-llm-models.sh` | Download model map from GitHub → local file. Auto-detects current branch and merges any per-branch override on top of the default. |
| `scripts/push-tests-llm-models.sh` | Upload local file → GitHub. Default target is `TESTS_LLM_MODELS_JSON`; pass `-b BRANCH` to target a per-branch override (override file should contain only diverging keys). |
| `.github/actions/fetch-tests-llm-models/action.yml` | Composite action used by CI workflows; injects default + per-branch override env vars and runs the fetch script. |
| `scripts/test-fixtures/key-migration.json` | Old→new key mapping (for migration reference). |
