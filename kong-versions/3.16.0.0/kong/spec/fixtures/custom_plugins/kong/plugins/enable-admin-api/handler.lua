-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-------------------------------------------------------------------------------
-- enable-admin-api plugin
-- 
-- This plugin allows you to dynamically enable admin API endpoints for Kong 
-- entities during testing. Particularly useful for testing plugins like ACE 
-- that don't expose their entities via the admin API by default.
--
-- SETUP INSTRUCTIONS:
--
-- 1. Include the plugin in get_db_utils:
--
--    local helpers = require "spec.helpers"
--    local bp, db
--    
--    -- Important: add "enable-admin-api" to the plugins list
--    bp, db = helpers.get_db_utils(strategy, 
--      {"routes", "services", "plugins", "consumers", "ace_operations"}, 
--      {"enable-admin-api", "ace"})
--
-- 2. Configure and insert the plugin:
--
--    -- Insert the enable-admin-api plugin with desired configuration
--    assert(db.plugins:insert {
--      name = "enable-admin-api",
--      config = {
--        -- Choose ONE of the following configuration approaches:
--        
--        -- Option 1: Enable admin API for all entities from specific plugins
--        plugins = {"ace"},
--      }
--    })
--
-- 3. Include the plugin in Kong configuration:
--
--    -- When starting Kong in your test
--    assert(helpers.start_kong({
--      database = strategy,
--      plugins = "bundled,enable-admin-api,ace",  -- Include enable-admin-api
--      nginx_conf = "spec/fixtures/custom_nginx.template",
--      -- Other configuration options...
--    }))
--
-------------------------------------------------------------------------------

local EnableAdminApiHandler = {
  PRIORITY = 1000001,  -- Higher priority to ensure it loads before other plugins
  VERSION = "1.0.0",
}

function EnableAdminApiHandler:init_worker()
  local config

  for plugin, err in kong.db.plugins:each() do
    if err then
      ngx.log(ngx.ERR, "enable-admin-api: Error retrieving plugins: ", err)
      return
    end
    if plugin.name == "enable-admin-api" then
      config = plugin.config
      break
    end
  end

  if not config then
    ngx.log(ngx.ERR, "enable-admin-api: No configuration found for the plugin")
    return
  end

  -- Create a lookup table to track which dao should have admin API enabled
  local dao_to_enable = {}

  -- Process plugins configuration
  if config.plugins and #config.plugins > 0 then
    for _, plugin_name in ipairs(config.plugins) do
      local plugin_daos = require("kong.plugins." .. plugin_name .. ".daos")
      if plugin_daos then
        for _, schema in ipairs(plugin_daos) do
          dao_to_enable[schema.name] = true
          -- set generate_admin_api flag on the schema
          schema.generate_admin_api = true
        end
      end
    end
  end

  -- if dao_to_enable is empty, nothing to do
  if next(dao_to_enable) == nil then
    ngx.log(ngx.ERR, "[enable-admin-api] No DAOs to enable admin API for. Exiting.")
    return
  end

  -- Set kong.db.daos["ace_xxx"].schema.generate_admin_api to true
  for dao_name, dao in pairs(kong.db.daos) do
    if dao_to_enable[dao_name] then
      dao.schema.generate_admin_api = true
    end
  end
end

return EnableAdminApiHandler
