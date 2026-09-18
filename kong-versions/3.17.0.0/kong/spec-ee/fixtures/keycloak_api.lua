-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- references docs
-- https://www.keycloak.org/docs-api/23.0.4/rest-api/index.html

local helpers = require "spec.helpers"
-- `busted` swaps the global `assert` for luassert only inside spec files; a required module sees plain Lua `assert`, so reference the luassert singleton explicitly.
local luassert = require "luassert"

local fmt = string.format

local KEYCLOAK_CONTEXT_PATH = ""
local KEYCLOAK_HOSTNAME   = os.getenv("KONG_SPEC_TEST_KEYCLOAK_HOST") or "keycloak"
local KEYCLOAK_PORT       = os.getenv("KONG_SPEC_TEST_KEYCLOAK_PORT_8080") or "8080"
local KEYCLOAK_SSL_PORT   = os.getenv("KONG_SPEC_TEST_KEYCLOAK_PORT_8443") or "8443"
local KEYCLOAK_CLIENT_ID  = "admin-cli"
local KEYCLOAK_USERNAME   = "admin"
local KEYCLOAK_PASSWORD   = "test" -- retrieve the password from the openid-connect/.pongo/keycloak.yml
local KEYCLOAK_GRANT_TYPE = "password"
local KEYCLOAK_REALM      = "demo"

local KONG_CLIENT_ID      = "kong-client-secret"
local KONG_CLIENT_SECRET  = "38beb963-2786-42b8-8e14-a5f391b4ba93"

local _keycloak   = {}

local function api_uri(self, path, ...)
  local prefix = fmt("%s/admin/realms/%s", self.config.context_path, self.config.realm)
  return prefix .. fmt(path, ...)
end

-- Sends a resource-owner password grant (RFC 6749 §4.3):
--   master-realm admin (admin-cli / admin) when `opts` is omitted,
--   or a configured-realm user login when `opts` carries `username`/`password`.
--
-- `client_secret`/`scope` are set only for the user-login case. This supports both a public client (admin-cli, no secret) and a confidential client.
---@param client table an http client pointing at keycloak, e.g. `helpers.http_client(config.host_name, config.port)`
---@param opts? table user login: `username`, `password`, and optional `client_id`, `client_secret`, `scope` (default "openid", which also returns an id token). Omit for master-realm admin auth.
---@return table @the raw response (caller reads status / body, e.g. `luassert.response(res).has.jsonbody()`)
function _keycloak:auth(client, opts)
  local is_master = not opts

  local realm  = is_master and "master" or self.config.realm
  local params = {
    client_id  = is_master and KEYCLOAK_CLIENT_ID or (opts.client_id or self.config.client_id),
    username   = is_master and KEYCLOAK_USERNAME or opts.username,
    password   = is_master and KEYCLOAK_PASSWORD or opts.password,
    grant_type = KEYCLOAK_GRANT_TYPE
  }

  if not is_master then
    params.client_secret = opts.client_secret or self.config.client_secret
    params.scope         = opts.scope or "openid"
  end

  return client:send {
    method  = "POST",
    path    = fmt("%s/realms/%s/protocol/openid-connect/token", self.config.context_path, realm),
    body    = params,
    headers = {
      ["Content-Type"] = "application/x-www-form-urlencoded",
    }
  }
end

-- Convenience wrapper over :auth. Creates (and closes) its own keycloak-bound http client and returns the decoded token table.
-- Recommended to call per `it` to avoid a stale token.
---@param opts? table see :auth
---@return table @the decoded token response (access_token, id_token, refresh_token, etc.)
function _keycloak:mint_tokens(opts)
  local client = helpers.http_client(self.config.host_name, self.config.port)
  local res = self:auth(client, opts)
  luassert.response(res).has.status(200)
  local body = luassert.response(res).has.jsonbody()
  client:close()
  return body
end

-- return 201
function _keycloak:add_user(client, access_token, body)
  return client:send {
    method = "POST",
    body = body,
    path = api_uri(self, "/users"),
    headers = {
      ["Content-Type"] = "application/json",
      ["Authorization"] = access_token,
    }
  }
end

-- return 204
function _keycloak:delete_user(client, access_token, user_id)
  return client:send {
    method = "DELETE",
    path = api_uri(self, "/users/%s", user_id),
    headers = {
      ["Authorization"] = access_token,
    }
  }
end

-- return 200,
-- return userList
-- https://www.keycloak.org/docs-api/23.0.4/rest-api/index.html#_users
function _keycloak:get_users(client, access_token, username)
  return client:send {
    method = "GET",
    path = api_uri(self, "/users?exact=true&max=10&username=%s", username),
    headers = {
      ["Authorization"] = access_token,
    }
  }
end

-- return 201, no body
-- https://www.keycloak.org/docs-api/23.0.4/rest-api/index.html#_groups
function _keycloak:add_group(client, access_token, body)
  return client:send {
    method = "POST",
    path = api_uri(self, "/groups"),
    body = body,
    headers = {
      ["Content-Type"] = "application/json",
      ["Authorization"] = access_token,
    }
  }
end

-- return 204, no body
function _keycloak:delete_group(client, access_token, group_id)
  return client:send {
    method = "DELETE",
    path = api_uri(self, "/groups/%s", group_id),
    headers = {
      ["Content-Type"] = "application/json",
      ["Authorization"] = access_token,
    }
  }
end

-- return 200
-- return groups
function _keycloak:get_groups(client, access_token, name)
  return client:send {
    method = "GET",
    path = api_uri(self, "/groups?exact=true&max=10&search=%s", name),
    headers = {
      ["Authorization"] = access_token,
    }
  }
end

-- return 204, no body
function _keycloak:add_group_to_user(client, access_token, user_id, group_id)
  return client:send {
    method = "PUT",
    path = api_uri(self, "/users/%s/groups/%s", user_id, group_id),
    headers = {
      ["Authorization"] = access_token,
    }
  }
end

-- return 204, no body
function _keycloak:delete_group_from_user(client, access_token, user_id, group_id)
  return client:send {
    method = "DELETE",
    path = api_uri(self, "/users/%s/groups/%s", user_id, group_id),
    headers = {
      ["Authorization"] = access_token,
    }
  }
end

local _M = {}

function _M.new(keycloak_config)
  keycloak_config = keycloak_config or {}
  local config = {
    context_path = keycloak_config.context_path or KEYCLOAK_CONTEXT_PATH,
    realm = keycloak_config.realm or KEYCLOAK_REALM,
    host_name = keycloak_config.host_name or KEYCLOAK_HOSTNAME,
    port = keycloak_config.port or KEYCLOAK_PORT,
    ssl_port = keycloak_config.ssl_port or KEYCLOAK_SSL_PORT,
    client_id = keycloak_config.client_id or KONG_CLIENT_ID,
    client_secret = keycloak_config.client_secret or KONG_CLIENT_SECRET,
  }

  config.realm_path = fmt("%s/realms/%s", config.context_path, config.realm)
  config.host = config.host_name .. ":" .. config.port
  config.ssl_host = config.host_name .. ":" .. config.ssl_port
  config.issuer = fmt("http://%s%s/realms/%s", config.host, config.context_path, config.realm)
  config.ssl_issuer = fmt("https://%s%s/realms/%s", config.ssl_host, config.context_path, config.realm)
  config.issuer_discovery = fmt("http://%s%s/realms/%s/.well-known/openid-configuration",
    config.host,
    config.context_path,
    config.realm
  )
  config.ssl_issuer_discovery = fmt("https://%s%s/realms/%s/.well-known/openid-configuration",
    config.ssl_host,
    config.context_path,
    config.realm
  )

  config.token_endpoint = fmt("http://%s%s/realms/%s/protocol/openid-connect/token", 
    config.host,
    config.context_path,
    config.realm
  )

  local self = {
    config = config
  }

  return setmetatable(self, { __index = _keycloak })
end

return _M
