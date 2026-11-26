-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Replaces the balancer target in the stream preread phase. No bundled plugin
-- calls `kong.service.set_target` there, so the balancer tests need this
-- fixture to cover `preread.after`.

local kong = kong


local PrereadSetTarget = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function PrereadSetTarget:preread(conf)
  kong.service.set_target(conf.host, conf.port)
end


return PrereadSetTarget
