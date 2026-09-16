-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


local sandbox = require("kong.tools.sandbox").sandbox
local new_buffer = require("string.buffer").new


local find = string.find
local ipairs = ipairs


local SandboxTests = {
  PRIORITY = 5843,
  VERSION = "1.0",
}


function SandboxTests:access()
  -- positive tests:

  local buf = new_buffer()
  local mode = kong.configuration.untrusted_lua

  require("kong.tools.sandbox.environment." .. mode):gsub("%S+", function(env_var)
    local var = env_var:gsub("%:", ".")
    buf:putf("assert(%s ~= nil, [[%q is not allowed in sandbox]])\n", var, env_var)
  end)

  require("kong.tools.sandbox.require." .. mode):gsub("%S+", function(module)
    if module ~= "argon2" and module ~= "resty.azure.api.certificates" then
      buf:putf("assert(require(%q) ~= nil, [[%q is not available in sandbox]])\n", module, module)
    end
  end)

  buf:put("return true\n")

  assert(sandbox(buf:get())())

  -- negative tests:

  local ok, err = pcall(sandbox([[
    ngx.timer.at(0, function()
      return true
    end)
    return true
  ]]))

  assert(ok == false)
  assert(find(err, "attempt to index field 'timer' (a nil value)", 1, true))

  kong.log.err(err)

  ok, err = pcall(sandbox([[
    local timer_ng = require("resty.timerng")
    return true
  ]]))

  assert(ok == false)
  assert(find(err, 'require("resty.timerng") not allowed within sandbox', 1, true))

  return kong.response.exit(418)
end


function SandboxTests:ws_handshake()
  return self:access()
end


function SandboxTests:preread()
  -- positive tests:

  local buf = new_buffer()
  local mode = kong.configuration.untrusted_lua

  local env = require("kong.tools.sandbox.stream").environment(mode)
  for _, env_var in ipairs(env) do
    local var = env_var:gsub("%:", ".")
    buf:putf("assert(%s ~= nil, [[%q is not allowed in sandbox]])\n", var, env_var)
  end

  local packages = require("kong.tools.sandbox.stream").requires(mode)
  for _, package in ipairs(packages) do
    if package ~= "argon2" and package ~= "resty.azure.api.certificates" then
      buf:putf("assert(require(%q) ~= nil, [[%q is not available in sandbox]])\n", package, package)
    end
  end

  buf:put("return true\n")

  assert(sandbox(buf:get())())

  -- negative tests:

  local ok, err = pcall(sandbox([[
    ngx.timer.at(0, function()
      return true
    end)
    return true
  ]]))

  assert(ok == false)
  assert(find(err, "attempt to index field 'timer' (a nil value)", 1, true))

  kong.log.err(err)

  ok, err = pcall(sandbox([[
    local timer_ng = require("resty.timerng")
    return true
  ]]))

  assert(ok == false)
  assert(find(err, 'require("resty.timerng") not allowed within sandbox', 1, true))

  kong.response.exit(200, "sandbox preread handler succeeded")
end


return SandboxTests
