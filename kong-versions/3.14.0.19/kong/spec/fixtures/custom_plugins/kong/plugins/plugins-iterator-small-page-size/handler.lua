-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Shrinks the plugins-iterator page size so tests can force PluginsIterator.new()
-- to cross a page boundary (and run its version check) with just a handful of
-- plugin instances.
--
-- Pair with the older-version fixture for a test that also needs the control
-- plane to fall back to legacy (v1) sync.
local SMALL_PAGE_SIZE = 2

local PluginsIteratorSmallPageSizeHandler = {
  VERSION = "1.0.0",
  PRIORITY = 1000,
}

function PluginsIteratorSmallPageSizeHandler.init_worker()
  -- the DAO's default page_size (1000) exceeds a max_page_size this small,
  -- which validate_options_value() rejects -- shrink both
  kong.db.plugins.pagination.page_size = SMALL_PAGE_SIZE
  kong.db.plugins.pagination.max_page_size = SMALL_PAGE_SIZE
end

return PluginsIteratorSmallPageSizeHandler
