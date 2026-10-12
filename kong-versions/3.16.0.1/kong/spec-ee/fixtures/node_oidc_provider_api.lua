-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local fmt = string.format

local NODE_OIDC_PROVIDER_HOSTNAME   = os.getenv("KONG_SPEC_TEST_NODE_OIDC_PROVIDER_HOST") or "localhost"
local NODE_OIDC_PROVIDER_PORT       = os.getenv("KONG_SPEC_TEST_NODE_OIDC_PROVIDER_PORT_13000") or "13000"

local KONG_CLIENT_ID                = "kong-client-dpop"
local KONG_CLIENT_SECRET            = "hOfxl46eEa7BI5RMmB5ROJQaSCdRheDs"

local _node_oidc_provider           = {}

-- Token Endpoint - primarily for client_credentials
function _node_oidc_provider:auth(client, params)
  params = params or {}
  local client_id = params.client_id or self.config.client_id
  local client_secret = params.client_secret or self.config.client_secret
  local grant_type = params.grant_type or "client_credentials"

  return client:send {
    method = "POST",
    path = "/token",
    body = {
      client_id = client_id,
      client_secret = client_secret,
      grant_type = grant_type,
    },
    headers = {
      ["Content-Type"] = "application/x-www-form-urlencoded",
    }
  }
end

local _M = {}

function _M.new(node_oidc_provider_config)
  node_oidc_provider_config = node_oidc_provider_config or {}
  local config = {
    host_name = node_oidc_provider_config.host_name or NODE_OIDC_PROVIDER_HOSTNAME,
    port = node_oidc_provider_config.port or NODE_OIDC_PROVIDER_PORT,
    client_id = node_oidc_provider_config.client_id or KONG_CLIENT_ID,
    client_secret = node_oidc_provider_config.client_secret or KONG_CLIENT_SECRET,
  }

  config.host = config.host_name .. ":" .. config.port
  config.issuer = fmt("http://%s", config.host)
  config.issuer_discovery = fmt("http://%s/.well-known/openid-configuration", config.host)

  local self = {
    config = config
  }

  return setmetatable(self, { __index = _node_oidc_provider })
end

return _M
