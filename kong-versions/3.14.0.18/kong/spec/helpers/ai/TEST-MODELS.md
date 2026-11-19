# Test LLM Model Map

Centralized mapping from abstract keys to real model names for AI plugin tests.

The default source of truth is the **GitHub Actions variable
`TESTS_LLM_MODELS_JSON`** on the `Kong/kong-ee` repository. Per-branch
overrides (e.g. for LTS maintenance branches) are supported — see
[Per-branch overrides](#per-branch-overrides) below.
CI injects the variable into the environment; locally it materializes to
`scripts/test-fixtures/tests_llm_models_json.json` (.gitignored).

Only the TypeScript e2e suite consumes the map:

| Language | File | API |
|----------|------|-----|
| TypeScript | `spec-ee/kong-api-tests/support/config/test-models.ts` | `getModel(key)` |

The loader gracefully degrades: when the map file is unavailable, `getModel()`
returns the abstract key itself so tests can still load (individual tests
requiring real model names will fail).

## How It Works

### In CI

Three pieces do the work:

1. `.github/actions/gateway-workflows/resolve-lts-variable/action.yml` resolves
   two override variable names: `name` for the branch under test
   (`github.head_ref || github.ref_name`) and `base-name` for the branch a pull
   request targets (`github.event.pull_request.base.ref`).
2. The calling workflow looks both values up in the `vars` context and passes
   them to `.github/actions/fetch-tests-llm-models/action.yml` as `base-json`
   and `lts-json`.
3. The action injects `TESTS_LLM_MODELS_JSON` (default),
   `TESTS_LLM_MODELS_JSON_BASE` and `TESTS_LLM_MODELS_JSON_LTS` into the env,
   then runs `scripts/fetch-tests-llm-models.sh` to materialize the JSON file.

Workflows reference them like this:

```yaml
- name: Resolve LTS variable name
  id: lts_name
  uses: ./.github/actions/gateway-workflows/resolve-lts-variable

- name: Download test LLM model map
  uses: ./.github/actions/fetch-tests-llm-models
  with:
    default-json: ${{ vars.TESTS_LLM_MODELS_JSON }}
    base-json: ${{ vars[steps.lts_name.outputs.base-name] }}
    lts-json: ${{ vars[steps.lts_name.outputs.name] }}
```

Consumed by the TypeScript e2e workflows: `gateway-api-tests.yml`,
`gateway-api-docker-test-matrix.yml`, `gateway-api-postgres-test-matrix.yml`,
`gateway-api-package-test-matrix.yml`, `gateway-cluster-api-tests.yml`, and
`gateway-konnect-api-tests.yml`. The first three resolve both override names.

Three lanes never resolve an override name, so they pass the default only:
`gateway-api-package-test-matrix.yml` uses the fetch action, and
`gateway-konnect-api-tests.yml` and `gateway-cluster-api-tests.yml` call
`scripts/fetch-tests-llm-models.sh` directly. The only override they can pick up
is the script's git-branch fallback, which needs a branch checkout and an
authenticated `gh`, and CI has neither. So in those three lanes a PR into an LTS
branch does not get that branch's pin, and a feature branch does not get the
model ids it stages in its own override.

The Lua busted lane, `build_and_test__busted_tests.yml`, also uses the fetch
action. It calls `scripts/resolve-tests-llm-models-lts-name.sh` directly with
`github.base_ref || github.ref_name` and passes only `lts-json`. So a PR gets the
override of the branch it targets, but not the override of its head branch.

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
# run tests — the TS e2e loader reads this file
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
> files that reference that key. Grep for the old key across the TypeScript
> e2e suite under `spec-ee/kong-api-tests/`.

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
gemini.vision.small              → gemini-3.1-flash-image (vision model)
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
fetched JSON is
`default + target_branch_overrides + branch_under_test_overrides` (later layers
win on conflict).

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
| `master` | _none — uses `TESTS_LLM_MODELS_JSON` only_ |
| `AG-1234-new-models` (feature branch, optional) | `TESTS_LLM_MODELS_JSON__AG_1234_NEW_MODELS` |
| `next/3.8.x.x` | `TESTS_LLM_MODELS_JSON__NEXT_3_8_X_X` |
| `next/3.9.x.x` | `TESTS_LLM_MODELS_JSON__NEXT_3_9_X_X` |

A branch or a pull request target with no matching override variable
contributes no layer, so it silently uses the default unmerged, and nothing
changes for branches that don't opt in.

### Resolution

A run resolves the branch it is testing and, on a pull request, the branch it
targets:

- **The branch under test** is the PR head branch, or the ref that runs on a
  push, a schedule or a dispatch. Its override wins on conflicting keys, which
  is what lets a feature branch stage new model ids and have its PR check use
  them. The cost is that for a key it sets, the target branch's pin does not
  apply: one override per branch name cannot stage a different value for each
  branch that PR is opened against. On a pull request the head branch is read
  from the PR event payload (`github.event.pull_request.head.ref`), for the
  same reason as the target branch below. A dispatch that tests another
  branch's image still resolves the ref the dispatch runs on, not the image's
  branch.
- **The pull request target branch** comes second, so an LTS pin still applies
  to a PR raised into that LTS branch, for every key the branch under test does
  not set. It is read from the PR event payload
  (`github.event.pull_request.base.ref`), not from the run-level ref, because
  the run-level ref names the wrong branch on some stacked PRs (AG-1647).
  Outside a pull request there is no target branch, and the resolver returns the
  branch-under-test name again, so the lookup stays a valid variable name and
  the repeated layer is a no-op.

The action injects up to three env vars; the fetch script merges them in that
order:

| Default | Target branch override | Branch under test override | Result on disk |
|---|---|---|---|
| set | empty/unset | empty/unset | default as-is |
| set | set | empty/unset | `jq '$default + $base'` (shallow merge, target wins) |
| set | empty/unset | set | `jq '$default + $lts'` (shallow merge, branch wins) |
| set | set | set | `jq '$default + $base + $lts'` (shallow merge, branch wins) |
| empty/unset | set | any | the override(s), with a warning |

The target branch layer exists only where a lane runs on a pull request. Of the
lanes that resolve names, that is only `gateway-api-tests.yml` (called by
`release.yml`). No workflow in this repo calls the docker and postgres
matrices (they also accept `workflow_call`), so in practice they run on dispatch
and the layer is absent there. It is also absent locally: nothing derives it
outside CI.

The CI log line
`[tests-llm-models] materialized: source=Kong/kong-ee/TESTS_LLM_MODELS_JSON + base branch override + branch override`
names the layers that were merged, so a missing layer is visible. The resolve
step prints the branch-under-test name, and the target branch name when it
differs, so a name that matches no repository variable is distinguishable from a
typo.

`jq` is required when an override layer is present, and available on all
GitHub-hosted runners; the entry-count summary falls back to `python3` when it
is missing. A layer that is not a single JSON object, and an empty default,
fail the step with the variable name.

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

### Stage model ids on a feature branch

A feature branch can test new model ids before they reach the default: push
them to its own override with
`bash scripts/push-tests-llm-models.sh -f /tmp/override.json -b <branch>`.
The override applies only to runs of that branch. Before the PR merges:

1. Copy the staged keys into the default (`TESTS_LLM_MODELS_JSON`). After the
   merge, runs on the target branch do not read the feature override, so
   without this step the target branch tests the old ids.
2. Delete the feature override after the merge
   (`gh variable delete TESTS_LLM_MODELS_JSON__<BRANCH> -R Kong/kong-ee`). An
   override that stays behind is picked up by any later branch with the same
   name.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/fetch-tests-llm-models.sh` | Download model map from GitHub → local file. Merges the default, the PR target branch override and the branch-under-test override, in that order. |
| `scripts/push-tests-llm-models.sh` | Upload local file → GitHub. Default target is `TESTS_LLM_MODELS_JSON`; pass `-b BRANCH` to target a per-branch override (override file should contain only diverging keys). |
| `scripts/resolve-tests-llm-models-lts-name.sh` | Compute the override variable names (`name`, `base-name`) for the branch under test and the PR target branch. |
| `.github/actions/gateway-workflows/resolve-lts-variable/action.yml` | Composite action that runs the resolver with the branch names from the github context. |
| `.github/actions/fetch-tests-llm-models/action.yml` | Composite action used by CI workflows; injects the default and override values and runs the fetch script. |
| `scripts/test-fixtures/key-migration.json` | Old→new key mapping (for migration reference). |
