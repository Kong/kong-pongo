-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Stalls the first service lookup new_router() makes on this worker, giving a
-- concurrent config push time to invalidate the router version mid-rebuild.
-- Patches both kong.db.services.select() (dbless path) and
-- kong.core_cache:get() (every other path -- a shared L2, so only the one
-- worker that misses ever calls select()).
--
-- Gated to the "timer" phase (the router-rebuild timer / reconfigure_handler)
-- and to "services:"-prefixed cache keys, so unrelated calls -- Admin API
-- route creation, balancer.init()'s startup timer -- don't burn the one-time
-- stall before the real rebuild runs.
--
-- Pair with router-small-page-size to also force a page boundary.
local STALL_SECONDS = 3
local SERVICES_CACHE_KEY_PREFIX = "services:"

local RouterSlowServiceLookupHandler = {
  VERSION = "1.0.0",
  PRIORITY = 1000,
}

-- Worker-local: stalls only once, so later rebuilds run at full speed.
local stalled = false

local function maybe_stall()
  if stalled or ngx.get_phase() ~= "timer" then
    return
  end

  stalled = true
  kong.log.notice("router-slow-service-lookup: stalling for ", STALL_SECONDS, "s")
  ngx.sleep(STALL_SECONDS)
  kong.log.notice("router-slow-service-lookup: resumed")
end

function RouterSlowServiceLookupHandler.init_worker()
  local services = kong.db.services
  local original_select = services.select

  services.select = function(self, pk, options)
    maybe_stall()
    return original_select(self, pk, options)
  end

  local core_cache = kong.core_cache
  if not core_cache then
    return
  end

  local original_get = core_cache.get

  core_cache.get = function(self, key, opts, cb, ...)
    if key:sub(1, #SERVICES_CACHE_KEY_PREFIX) == SERVICES_CACHE_KEY_PREFIX then
      maybe_stall()
    end
    return original_get(self, key, opts, cb, ...)
  end
end

return RouterSlowServiceLookupHandler
