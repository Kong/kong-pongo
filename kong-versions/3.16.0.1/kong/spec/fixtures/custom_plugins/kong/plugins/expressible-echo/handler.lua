-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


-- Echoes conf.message (an expressible field) into a response header from the
-- rewrite phase specifically -- for a globally-scoped plugin instance, this
-- is the one phase that always runs through
-- kong/runloop/plugins_iterator.lua's get_global_iterator(), not the ordinary
-- per-request combos path.
local ExpressibleEchoHandler = {
  VERSION = "1.0.0",
  PRIORITY = 1000,
}

function ExpressibleEchoHandler:rewrite(conf)
  kong.response.set_header("x-expressible-message", conf.message)
end

return ExpressibleEchoHandler
