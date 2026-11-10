-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--- Stubs `package.loaded[name]` entries for a unit test and restores the
--- previous value (or removes the entry entirely, if it wasn't loaded) once
--- the test is done. Use one instance per test (create it fresh in
--- `before_each`) so stubs from one test never leak into the next.
---
--- Usage:
---   local module_stub = require("spec.helpers.ai.module_stub")
---   local stubber
---
---   before_each(function()
---     stubber = module_stub.new()
---     stubber.stub("kong.llm.plugin.ctx", { ... })
---   end)
---
---   after_each(function()
---     -- pass the module under test too, so it's reloaded fresh next time
---     stubber.restore("kong.llm.plugin.shared-filters.normalize-request")
---   end)

local NIL = {}

local _M = {}

function _M.new()
  local old_modules = {}

  local self = {}

  --- Replaces `package.loaded[name]` with `module`, remembering whatever was
  --- there before (including "nothing", so restore() can put that back too).
  function self.stub(name, module)
    local old_module = package.loaded[name]
    old_modules[name] = old_module == nil and NIL or old_module
    package.loaded[name] = module
  end

  --- Restores every stubbed module to its pre-stub state.
  --- @param main_module_name string|nil also clear this module from
  ---   package.loaded, so the next test's require() reloads it fresh against
  ---   whatever it stubs next
  function self.restore(main_module_name)
    if main_module_name then
      package.loaded[main_module_name] = nil
    end

    for name, module in pairs(old_modules) do
      if module == NIL then
        package.loaded[name] = nil
      else
        package.loaded[name] = module
      end
    end
  end

  return self
end

return _M
