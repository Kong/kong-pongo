-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


local env = require "kong.vaults.env"


local getenv = os.getenv


local function init()
  env.init()
  assert(getenv("KONG_PROCESS_SECRETS") == nil, "KONG_PROCESS_SECRETS environment variable found")
  assert(env.get({}, "KONG_PROCESS_SECRETS") == nil, "KONG_PROCESS_SECRETS environment variable found")
end


local function get(conf, resource, version)
  return env.get(conf, resource, version)
end


return {
  VERSION = "1.0.0",
  init = init,
  get = get,
}
