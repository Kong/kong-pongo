-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- The first resolve yields after it sets a worker-local latch. Concurrent
-- resolves complete immediately to model two independent iterator builds.
local slowonce = {
  VERSION = "1.0.0",
}


local blocked = false


function slowonce.init()
end


function slowonce.get(conf, resource, version)
  local latency = tonumber(conf.latency) or 0
  if latency > 0 and not blocked then
    -- Set the latch before yielding so a concurrent resolver skips the sleep.
    blocked = true
    ngx.log(ngx.NOTICE, "slowonce: first resolve started blocking")
    ngx.sleep(latency)
    ngx.log(ngx.NOTICE, "slowonce: first resolve resumed")

  elseif blocked then
    ngx.log(ngx.NOTICE, "slowonce: later resolve completed without blocking")
  end

  return conf.default_value or "resolved"
end


return slowonce
