-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local FAIL_APPLY_KEY = "dynamic_log_level.fail_apply"


local DynamicLogLevelFailApplyHandler = {
  VERSION = "0.1-t",
  PRIORITY = 1000,
}


function DynamicLogLevelFailApplyHandler:init_worker()
  if kong.configuration.role ~= "data_plane" then
    return
  end

  local debug_log_level = require "kong.debug.log_level"
  if debug_log_level._dynamic_log_level_fail_apply_patched then
    return
  end

  local apply = debug_log_level.apply
  debug_log_level.apply = function(...)
    local err = ngx.shared.kong:get(FAIL_APPLY_KEY)
    if err then
      ngx.shared.kong:delete(FAIL_APPLY_KEY)
      return nil, err
    end

    return apply(...)
  end

  debug_log_level._dynamic_log_level_fail_apply_patched = true
end


return DynamicLogLevelFailApplyHandler
