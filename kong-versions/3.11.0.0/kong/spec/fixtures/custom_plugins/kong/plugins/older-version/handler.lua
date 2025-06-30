-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


local meta = require "kong.meta"


local version = setmetatable({
  major = 3,
  minor = 9,
  patch = 0,
}, {
  __tostring = function(t)
    return string.format("%d.%d.%d%s", t.major, t.minor, t.patch,
            t.suffix or "")
  end
})


local OlderVersion =  {
  VERSION = "1.0.0",
  PRIORITY = 1000,
}


function OlderVersion:init_worker()
  meta._VERSION = tostring(version)
  meta._VERSION_TABLE = version
  meta._SERVER_TOKENS = "kong/" .. tostring(version)
  meta.version = tostring(version)
  kong.version = meta._VERSION
end


return OlderVersion
