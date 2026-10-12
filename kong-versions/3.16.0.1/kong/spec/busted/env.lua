-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local sys = require("spec.internal.sys")
local log = require("spec.internal.log")
---@type _busted
local busted = require("busted")

local fmt = string.format

local initialized = false

---@type { [_busted.types.context]: { [string]: string } }
local envs = {}
setmetatable(envs, { __mode = "k" })


local LIFECYCLE_DESCRIPTOR = {
  before_each = true,
  after_each = true,

  setup = true,
  lazy_setup = true,
  strict_setup = true,

  teardown = true,
  lazy_teardown = true,
  strict_teardown = true,
}


---@param ctx _busted.types.context
---@return string
local function mklabel(ctx)
  local desc = ctx.descriptor

  if desc == "suite" then
    return "suite"
  end

  return desc .. "(" .. (ctx.name or "") .. ")"
end


local function restore()
  -- return values expected by busted.publish()
  local ret, continue = nil, true

  local ctx = busted.context.get()
  local old = envs[ctx]
  if not old then
    return ret, continue
  end

  envs[ctx] = nil

  local label = mklabel(ctx)
  local new = sys.readenv()
  local ok, err

  for var, value in pairs(old) do
    if new[var] ~= value then
      log.printf("%s - ENV restore(%q) => %q", label, var, value)
      ok, err = sys.setenv(var, value)
      if not ok then
        error(fmt("failed restoring environment for context %q: set(%q) => %s",
                  label, var, err))
      end
    end
  end

  for var in pairs(new) do
    if not old[var] then
      log.printf("%s - ENV restore(%q) => <unset>", label, var)
      ok, err = sys.unsetenv(var)
      if not ok then
        error(fmt("failed restoring environment for context %q: unset(%q) => %s",
                  label, var, err))
      end
    end
  end

  return ret, continue
end


---@param action "set"|"unset"
---@param var string
local function save(action, var)
  if not initialized then
    error(fmt("%s(%q): cannot save environment: %s",
              action, var, "'spec.busted.env' was not initialized"))
  end

  local ctx = assert(busted.context.get())
  local label = mklabel(ctx)

  -- if we're in a before_each/setup/lazy_setup, we should act upon the parent
  -- context instead
  local is_parent = false
  local restore = ctx
  if LIFECYCLE_DESCRIPTOR[restore.descriptor] then
    is_parent = true
    restore = busted.context.parent(restore)

    -- i.e. before_each within lazy_setup--should be unreachable
    assert(not LIFECYCLE_DESCRIPTOR[restore.descriptor],
           "undefined behavior: nested lifecycle context")
  end

  if envs[restore] then
    if is_parent then
      log.printf("%s - %s(%q) - parent %q env is already saved",
                 label, action, var, mklabel(restore))
    else
      log.printf("%s - %s(%q) - env is already saved", label, action, var)
    end
  else
    if is_parent then
      log.printf("%s - %s(%q) - saving parent %q env",
                 label, action, var, mklabel(restore))
    else
      log.printf("%s - %s(%q) - saving env", label, action, var)
    end

    envs[restore] = sys.readenv()
  end
end


--- Sets an environment variable.
---
---@param var string
---@param value string
local function set(var, value)
  save("set", var)
  assert(sys.setenv(var, value))
end


--- Unsets an environment variable.
---
---@param var string
local function unset(var)
  save("unset", var)
  assert(sys.unsetenv(var))
end


local function busted_init()
  if initialized then
    return
  end

  for _, event in ipairs({
    -- suite reset, triggered by `--repeat=N`
    { "suite",    "reset" },

    -- file end
    { "file",     "end" },
    { "error",    "file" },

    -- describe/context end
    { "describe", "end" },
    { "error",    "describe" },

    -- it/test case end
    { "test",     "end" },
    { "error",    "it" },
    { "failure",  "it" },
  }) do
    busted.subscribe(event, restore)
  end

  initialized = true
end


return {
  get = sys.getenv,
  set = set,
  unset = unset,
  busted_init = busted_init,
}
