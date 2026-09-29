-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Shrinks the router page size so tests can force new_router() to cross a
-- page boundary (and run its version check) with just a handful of routes.
--
-- Pair with the older-version fixture for a test that also needs the control
-- plane to fall back to legacy (v1) sync.
local SMALL_PAGE_SIZE = 2

local RouterSmallPageSizeHandler = {
  VERSION = "1.0.0",
  PRIORITY = 1000,
}

function RouterSmallPageSizeHandler.init_worker()
  -- the DAO's default page_size (1000) exceeds a max_page_size this small,
  -- which validate_options_value() rejects -- shrink both
  kong.db.routes.pagination.page_size = SMALL_PAGE_SIZE
  kong.db.routes.pagination.max_page_size = SMALL_PAGE_SIZE
end

return RouterSmallPageSizeHandler
