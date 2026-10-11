-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local SlowConfigureHandler = {
  PRIORITY = 1000,
  VERSION = "1.0",
}


-- Delay reconfiguration after iterator construction but before installation.
-- The referenceable secret can delay iterator construction instead.
function SlowConfigureHandler:configure(configs)
  if not configs then
    return
  end

  local latency = 0
  for _, conf in ipairs(configs) do
    if conf.latency and conf.latency > latency then
      latency = conf.latency
    end
  end

  -- `ngx.sleep` yields and is not allowed in init/init_worker. A boot-time
  -- config runs `configure()` at init_worker, so guard the phase.
  local phase = ngx.get_phase()
  if latency > 0 and phase ~= "init" and phase ~= "init_worker" then
    kong.log.notice("slow-configure: stalling for ", latency, "s")
    ngx.sleep(latency)
  end
end


return SlowConfigureHandler
