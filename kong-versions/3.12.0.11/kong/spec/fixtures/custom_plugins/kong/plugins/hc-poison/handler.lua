-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Plugin fixture for FTI-7790. It replaces resty.healthcheck inside the Kong
-- worker process, so an integration test can make healthcheck.new() raise.
-- healthcheckers.init() re-requires resty.healthcheck on every declarative
-- reconfigure (balancer.init), so the next config push picks up this mock.
-- Startup has no upstreams, so the swap does not affect Kong startup.

local HCPoisonHandler = {
  PRIORITY = 1,
  VERSION = "1.0",
}

function HCPoisonHandler:init_worker()
  package.loaded["resty.healthcheck"] = {
    new = function()
      error("checks.passive.unhealthy.http_failures must be at most 254", 0)
    end,
  }
end

return HCPoisonHandler
