-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


local meta = require "kong.meta"


local DEFAULT_VERSION = "3.9.0"

local VERSION_MT = {
  __tostring = function(t)
    return string.format("%d.%d.%d%s", t.major, t.minor, t.patch,
            t.suffix or "")
  end
}


local function parse_version(str)
  local major, minor, patch, suffix = str:match("^(%d+)%.(%d+)%.(%d+)(.-)$")
  assert(major, "older-version: invalid version string " .. tostring(str))
  return setmetatable({
    major = tonumber(major),
    minor = tonumber(minor),
    patch = tonumber(patch),
    suffix = suffix ~= "" and suffix or nil,
  }, VERSION_MT)
end


local OlderVersion =  {
  VERSION = "1.0.0",
  PRIORITY = 1000,
}


-- Read from the environment, not plugin config: init_worker gets no conf.
function OlderVersion:init_worker()
  local version = parse_version(os.getenv("KONG_TEST_OLDER_VERSION") or DEFAULT_VERSION)
  meta._VERSION = tostring(version)
  meta._VERSION_TABLE = version
  meta._SERVER_TOKENS = "kong/" .. tostring(version)
  meta.version = tostring(version)
  kong.version = meta._VERSION
end


return OlderVersion
