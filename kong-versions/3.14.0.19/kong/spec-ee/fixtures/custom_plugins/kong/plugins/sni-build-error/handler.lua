-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local CACHE_KEY = "tls-handshake-modifier:cert_enabled_snis"
local FAILURE = "forced SNI set build failure"

local SniBuildError = {
  PRIORITY = 10000,
  VERSION = "1.0.0",
}

function SniBuildError:init_worker()
  local cache = kong.cache
  local original_get = cache.get

  rawset(cache, "get", function(self, key, ...)
    if key == CACHE_KEY then
      return nil, FAILURE
    end

    return original_get(self, key, ...)
  end)
end

return SniBuildError