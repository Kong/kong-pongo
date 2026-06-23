-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

------------------------------------------------------------------
-- Collection of utilities to help testing Kong features and plugins.
--
-- @copyright Copyright 2016-2022 Kong Inc. All rights reserved.
-- @license [Apache 2.0](https://opensource.org/licenses/Apache-2.0)
-- @module spec.helpers


local ffi = require("ffi")


ffi.cdef [[
  int setenv(const char *name, const char *value, int overwrite);
  int unsetenv(const char *name);
  extern char **environ;
]]


--- Set an environment variable
-- @function setenv
-- @param env (string) name of the environment variable
-- @param value the value to set
-- @return true on success, false otherwise
local function setenv(env, value)
  assert(type(env) == "string", "env must be a string")
  assert(type(value) == "string", "value must be a string")
  return ffi.C.setenv(env, value, 1) == 0
end


--- Unset an environment variable
-- @function unsetenv
-- @param env (string) name of the environment variable
-- @return true on success, false otherwise
local function unsetenv(env)
  assert(type(env) == "string", "env must be a string")
  return ffi.C.unsetenv(env) == 0
end


-- mostly copy/paste from `kong.cmd.utils.env`
---@return { [string]: string? }
local function readenv()
  local env = {}

  local environ = ffi.C.environ
  if not environ then
    error("failed to read **environ")
  end

  local i = 0

  while environ[i] ~= nil do
    local l = ffi.string(environ[i])
    local eq = string.find(l, "=", nil, true)

    if eq then
      local name = string.sub(l, 1, eq - 1)
      local val = string.sub(l, eq + 1)
      env[name] = val
    end

    i = i + 1
  end

  return env
end



return {
  getenv = os.getenv,
  setenv = setenv,
  unsetenv = unsetenv,
  readenv = readenv,
}
