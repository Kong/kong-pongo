-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local cjson = require "cjson.safe"
local pl_file = require "pl.file"

local _M = {}
local _cache
local _loaded     -- true once load() has run (even if map is empty)
local _patterns   -- pre-computed gsub patterns, built once after first load()

local RESOLVE_KEYS = {
  model        = true,
  modelVersion = true,
  modelArn     = true,
}

-- Path relative to this file: spec/helpers/ai/ -> ../../../scripts/test-fixtures/
local _src = debug.getinfo(1, "S").source:sub(2)  -- strip leading @
local _dir = _src:match("(.*/)") or "./"
local MODELS_FILE_PATH = _dir .. "../../../scripts/test-fixtures/tests_llm_models_json.json"
local FETCH_SCRIPT = _dir .. "../../../scripts/fetch-tests-llm-models.sh"

-- Debug logging is auto-enabled when running under CI (GitHub Actions and
-- essentially every CI system sets CI=true). Locally it stays silent unless
-- the developer explicitly runs with CI=true.
local DEBUG_ENABLED = (function()
  local v = os.getenv("CI")
  return v == "1" or v == "true" or v == "TRUE"
end)()

local function dbg(fmt, ...)
  if not DEBUG_ENABLED then
    return
  end
  io.stderr:write(string.format("[tests-llm-models][debug] " .. fmt .. "\n", ...))
end

local function count_keys(t)
  local n = 0
  for _ in pairs(t) do
    n = n + 1
  end
  return n
end


local function load()
  if _loaded then
    return _cache
  end
  _loaded = true

  local content = pl_file.read(MODELS_FILE_PATH)
  if not content or content == "" then
    dbg("load: dest missing, running fetch script: %s", FETCH_SCRIPT)
    local ok, _, rc = os.execute("bash " .. FETCH_SCRIPT)
    -- Lua 5.1 returns the numeric exit code directly; 5.2+ returns (ok, kind, code)
    local exit_code = rc or (type(ok) == "number" and ok) or (ok and 0 or 1)
    dbg("load: fetch exit=%s", tostring(exit_code))
    content = pl_file.read(MODELS_FILE_PATH)
  end

  if not content or content == "" then
    dbg("load: failed to materialize map")
    io.stderr:write(
      "WARNING: Test model map not available — get() will return abstract keys.\n" ..
      "  Run: bash scripts/fetch-tests-llm-models.sh\n" ..
      "  (requires GITHUB_TOKEN or GH_TOKEN with read access to Kong/gateway-action-storage)\n"
    )
    return nil
  end

  _cache = assert(cjson.decode(content), "invalid JSON in test model map")
  dbg("load: loaded entries=%d", count_keys(_cache))
  return _cache
end


function _M.get(key)
  assert(type(key) == "string", "key must be a string")
  local models = load()
  if not models then
    dbg("get: map unavailable, returning abstract key src=%s", key)
    return key
  end
  local val = models[key]
  if val == nil then
    dbg("get: unknown key src=%s", key)
    error("unknown test model key: " .. key)
  end
  dbg("get: src=%s dst=%s", key, val)
  return val
end


--- Escape Lua pattern special characters in a string.
local function pattern_escape(s)
  return (s:gsub("([%.%-%+%*%?%[%]%^%$%(%)%%])", "%%%1"))
end

--- Escape replacement-string special characters (only '%' is special).
local function replacement_escape(s)
  return (s:gsub("%%", "%%%%"))
end

--- Build pre-computed gsub pattern/replacement pairs (called once after load).
local function build_patterns()
  if _patterns then
    return _patterns
  end
  local models = load()
  if not models then
    _patterns = {}
    return _patterns
  end
  local pats = {}
  for abstract_key, resolved_name in pairs(models) do
    local ek = pattern_escape(abstract_key)
    local rv = replacement_escape(resolved_name)
    for field_name in pairs(RESOLVE_KEYS) do
      pats[#pats + 1] = {
        '("' .. field_name .. '"%s*:%s*)"' .. ek .. '"',
        '%1"' .. rv .. '"',
        field = field_name,
        src   = abstract_key,
        dst   = resolved_name,
      }
      pats[#pats + 1] = {
        '(\\"' .. field_name .. '\\"%s*:%s*)\\"' .. ek .. '\\"',
        '%1\\"' .. rv .. '\\"',
        field = field_name,
        src   = abstract_key,
        dst   = resolved_name,
      }
    end
  end
  _patterns = pats
  return _patterns
end

--- Format-preserving model key resolution.
-- Replaces abstract model keys (e.g. "openai.chat.mini") with resolved names
-- (e.g. "gpt-4o-mini") only in RESOLVE_KEYS fields (model, modelVersion, modelArn).
-- Preserves the original JSON formatting (whitespace, indentation, key order).
-- Handles both regular and escaped (double-encoded) JSON strings.
local function resolve_json_models(content)
  local pats = build_patterns()
  local hits          -- list of per-field substitution records when DEBUG_ENABLED
  local total = 0
  if DEBUG_ENABLED then
    hits = {}
  end
  for i = 1, #pats do
    local p = pats[i]
    local new, n = content:gsub(p[1], p[2])
    if n > 0 then
      total = total + n
      if DEBUG_ENABLED then
        hits[#hits + 1] = { field = p.field, src = p.src, dst = p.dst, count = n }
      end
    end
    content = new
  end
  if DEBUG_ENABLED then
    if total == 0 then
      dbg("resolve_json: no substitutions")
    else
      for i = 1, #hits do
        local h = hits[i]
        dbg("resolve_json: field=%s src=%s dst=%s count=%d", h.field, h.src, h.dst, h.count)
      end
      dbg("resolve_json: total substitutions=%d", total)
    end
  end
  return content
end


function _M.resolve_json(content)
  assert(type(content) == "string", "content must be a string")
  return resolve_json_models(content)
end


function _M.read_fixture(path)
  return resolve_json_models(assert(pl_file.read(path)))
end


--- Read a JSON fixture and render it with values from a table.
-- Replaces top-level fields in the fixture with values from the overrides table.
-- @param fixture_path string Path to the JSON fixture file
-- @param overrides table Table of field names to values to override (e.g., {model = request_body.model})
-- @return string JSON-encoded response with overrides applied
function _M.render_fixture(fixture_path, overrides)
  local content = assert(pl_file.read(fixture_path))
  content = resolve_json_models(content)
  if not overrides or next(overrides) == nil then
    return content
  end

  local body_table = cjson.decode(content)
  for key, value in pairs(overrides) do
    body_table[key] = value
  end
  return cjson.encode(body_table)
end


return _M
