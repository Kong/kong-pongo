-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Shrinks the dbless data plane's router-rebuild page size (hardcoded to
-- 2048 for db.strategy == "off") so tests can force new_router() to cross a
-- page boundary -- and run its router:version check -- with only a handful
-- of routes, instead of needing thousands of them.
--
-- Also reports a fake, low kong.version so the control plane (which is
-- really the same build) disables the "kong.sync.v2" RPC capability and the
-- data plane falls back to legacy (v1) sync -- see
-- kong/clustering/rpc/manager.lua's "disabling kong.sync.v2 because the
-- data plane is older" check. This only fakes the value read live by that
-- RPC handshake; the plain v1 websocket handshake reads its own
-- module-load-time copy of the real version, so the v1 compatibility check
-- itself still sees two matching, genuinely compatible nodes.
local SMALL_PAGE_SIZE = 2
local FAKE_OLD_VERSION = "0.0.0.1"

local RouterSmallPageSizeHandler = {
  VERSION = "1.0.0",
  PRIORITY = 1000,
}

function RouterSmallPageSizeHandler.init_worker()
  -- the DAO's default page_size (1000) exceeds a max_page_size this small,
  -- which validate_options_value() rejects -- shrink both
  kong.db.routes.pagination.page_size = SMALL_PAGE_SIZE
  kong.db.routes.pagination.max_page_size = SMALL_PAGE_SIZE
  kong.version = FAKE_OLD_VERSION
end

return RouterSmallPageSizeHandler
