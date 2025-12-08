local BasePlugin = require "kong.plugins.base_plugin"
local responses = require "kong.tools.responses"

local MediumPlugin = BasePlugin:extend()

function MediumPlugin:new()
  MediumPlugin.super.new(self, "medium-plugin")
end

function MediumPlugin:access(conf)
  MediumPlugin.super.access(self)
  -- Medium complexity: add header, check query, block if missing
  local req = kong.request
  local val = req.get_query_arg("token")
  if not val or val == "" then
    return kong.response.exit(401, { message = "Missing token" })
  end
  kong.response.set_header("X-Plugin-Token", val)
end

return MediumPlugin
