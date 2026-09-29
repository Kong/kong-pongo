-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


--- no code here, just some quality-of-life type annotations for busted


---@class _busted
---
---@field options table
---@field context _busted.context
---
--- Registers an event handler
---@field subscribe fun(event: string[], fn: _busted.types.event_handler)
---
--- Makes `<key>` available via `require("busted")[<key>]`
---@field exportApi fun(key: string, value: any)


---@alias _busted.types.event_handler fun(any...):value:any, continue:boolean|nil


---@class _busted.context
---
--- Returns the currently active context
---@field get fun(): _busted.types.context
---
--- Given a child context, returns its parent context
---@field parent fun(child: _busted.types.context): _busted.types.context


---@class _busted.types.context
---
---@field descriptor string
---@field name? string
---@field attributes { [string]: any }
