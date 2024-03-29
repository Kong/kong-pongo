-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local ssl_fixtures = require "spec.fixtures.ssl"
local utils = require "kong.tools.utils"


local deep_merge = utils.deep_merge
local fmt = string.format


local Blueprint   = {}
Blueprint.__index = Blueprint


-- TODO: port this back to OSS since it should be useful there too
function Blueprint:defaults(defaults)
  self._defaults = defaults
end

function Blueprint:build(overrides)
  overrides = overrides or {}
  if self._defaults then
    overrides = deep_merge(self._defaults, overrides)
  end

  return deep_merge(self.build_function(overrides), overrides)
end


function Blueprint:insert(overrides, options)
  local entity, err = self.dao:insert(self:build(overrides), options)
  if err then
    error(err, 2)
  end
  return entity
end


-- insert blueprint in workspace specified by `ws`
function Blueprint:insert_ws(overrides, workspace)
  local old_workspace = ngx.ctx.workspace

  ngx.ctx.workspace = workspace.id
  local entity = self:insert(overrides)
  ngx.ctx.workspace = old_workspace

  return entity
end


function Blueprint:remove(overrides, options)
  local entity, err = self.dao:remove({ id = overrides.id }, options)
  if err then
    error(err, 2)
  end
  return entity
end


function Blueprint:update(id, overrides, options)
  local entity, err = self.dao:update(id, overrides, options)
  if err then
    error(err, 2)
  end
  return entity
end


function Blueprint:upsert(id, overrides, options)
  local entity, err = self.dao:upsert(id, overrides, options)
  if err then
    error(err, 2)
  end
  return entity
end


function Blueprint:insert_n(n, overrides, options)
  local res = {}
  for i=1,n do
    res[i] = self:insert(overrides, options)
  end
  return res
end


local function new_blueprint(dao, build_function)
  return setmetatable({
    dao = dao,
    build_function = build_function,
  }, Blueprint)
end


local Sequence = {}
Sequence.__index = Sequence


function Sequence:next()
  self.count = self.count + 1
  return fmt(self.sequence_string, self.count)
end


local function new_sequence(sequence_string)
  return setmetatable({
    count           = 0,
    sequence_string = sequence_string,
  }, Sequence)
end


local _M = {}


function _M.new(db)
  local res = {}

  local sni_seq = new_sequence("server-name-%d")
  res.snis = new_blueprint(db.snis, function(overrides)
    return {
      name        = overrides.name or sni_seq:next(),
      certificate = overrides.certificate or res.certificates:insert(),
    }
  end)

  res.certificates = new_blueprint(db.certificates, function()
    return {
      cert = ssl_fixtures.cert,
      key  = ssl_fixtures.key,
    }
  end)

  res.ca_certificates = new_blueprint(db.ca_certificates, function()
    return {
      cert = ssl_fixtures.cert_ca,
    }
  end)

  local upstream_name_seq = new_sequence("upstream-%d")
  res.upstreams = new_blueprint(db.upstreams, function(overrides)
    local slots = overrides.slots or 100
    local name = overrides.name or upstream_name_seq:next()
    local host_header = overrides.host_header or nil

    return {
      name      = name,
      slots     = slots,
      host_header = host_header,
    }
  end)

  local consumer_custom_id_seq = new_sequence("consumer-id-%d")
  local consumer_username_seq = new_sequence("consumer-username-%d")
  res.consumers = new_blueprint(db.consumers, function()
    return {
      custom_id = consumer_custom_id_seq:next(),
      username  = consumer_username_seq:next(),
    }
  end)

  local developer_email_seq = new_sequence("dev-%d@example.com")
  res.developers = new_blueprint(db.developers, function()
    return {
      email = developer_email_seq:next(),
    }
  end)

  res.targets = new_blueprint(db.targets, function(overrides)
    return {
      weight = 10,
      upstream = overrides.upstream or res.upstreams:insert(),
    }
  end)

  res.plugins = new_blueprint(db.plugins, function()
    return {}
  end)

  res.routes = new_blueprint(db.routes, function(overrides)
    local service = overrides.service
    local protocols = overrides.protocols

    local route = {
      service = service,
    }

    if type(service) == "table" then
      -- set route.protocols from service
      if service.protocol == "ws" or
         service.protocol == "wss" and
        not protocols
      then
        route.protocols = { service.protocol }
      end

    else
      service = {}

      -- set service.protocol from route.protocols
      if type(protocols) == "table" then
        for _, proto in ipairs(protocols) do
          if proto == "ws" or proto == "wss" then
            service.protocol = proto
            break
          end
        end
      end

      service = res.services:insert(service)

      -- reverse: set route.protocols based on the inserted service, which
      -- may have inherited some defaults
      if protocols == nil and
         (service.protocol == "ws" or service.protocol == "wss")
      then
        route.protocols = { service.protocol }
      end

      route.service = service
    end

    return route
  end)

  res.services = new_blueprint(db.services, function(overrides)
    local service = {
      protocol = "http",
      host = "127.0.0.1",
      port = 15555,
    }

    service.protocol = overrides.protocol or service.protocol

    if service.protocol == "ws" then
      service.port = 3000

    elseif service.protocol == "wss" then
      service.port = 3001
    end

    return service
  end)

  res.vaults = new_blueprint(db.vaults, function(overrides)
    local vault = {
      name = "env",
      prefix = "env-1",
      description = "description",
    }

    vault.prefix = overrides.prefix or vault.prefix
    vault.description = overrides.description or vault.description

    return vault
  end)

  res.consumer_groups = new_blueprint(db.consumer_groups, function(overrides)
      local consumer_groups = {
          name = "testGroup",
      }

      consumer_groups.name = overrides.name or consumer_groups.name

      return consumer_groups
    end)
  
    res.consumer_group_consumers = new_blueprint(db.consumer_group_consumers, function(overrides)
      local consumer_group_consumers = {}

      consumer_group_consumers.consumer = overrides.consumer or consumer_group_consumers.consumer
      consumer_group_consumers.consumer_group = overrides.consumer_group or consumer_group_consumers.consumer_group

      return consumer_group_consumers
    end)
  
  res.clustering_data_planes = new_blueprint(db.clustering_data_planes, function()
    return {
      hostname = "dp.example.com",
      ip = "127.0.0.1",
      config_hash = "a9a166c59873245db8f1a747ba9a80a7",
    }
  end)

  local named_service_name_seq = new_sequence("service-name-%d")
  local named_service_host_seq = new_sequence("service-host-%d.test")
  res.named_services = new_blueprint(db.services, function()
    return {
      protocol = "http",
      name = named_service_name_seq:next(),
      host = named_service_host_seq:next(),
      port = 15555,
    }
  end)

  local named_route_name_seq = new_sequence("route-name-%d")
  local named_route_host_seq = new_sequence("route-host-%d.test")
  res.named_routes = new_blueprint(db.routes, function(overrides)
    return {
      name = named_route_name_seq:next(),
      hosts = { named_route_host_seq:next() },
      service = overrides.service or res.services:insert(),
    }
  end)

  res.acl_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "acl",
      config = {},
    }
  end)

  local acl_group_seq = new_sequence("acl-group-%d")
  res.acls = new_blueprint(db.acls, function()
    return {
      group = acl_group_seq:next(),
    }
  end)

  res.cors_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "cors",
      config = {
        origins         = { "example.com" },
        methods         = { "GET" },
        headers         = { "origin", "type", "accepts"},
        exposed_headers = { "x-auth-token" },
        max_age         = 23,
        credentials     = true,
      }
    }
  end)

  res.loggly_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "loggly",
      config = {}, -- all fields have default values already
    }
  end)

  res.tcp_log_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "tcp-log",
      config = {
        host = "127.0.0.1",
        port = 35001,
      },
    }
  end)

  res.udp_log_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "udp-log",
      config = {
        host = "127.0.0.1",
        port = 35001,
      },
    }
  end)

  res.jwt_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "jwt",
      config = {},
    }
  end)

  local jwt_key_seq = new_sequence("jwt-key-%d")
  res.jwt_secrets = new_blueprint(db.jwt_secrets, function()
    return {
      key       = jwt_key_seq:next(),
      secret    = "secret",
    }
  end)

  res.oauth2_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "oauth2",
      config = {
        scopes                    = { "email", "profile" },
        enable_authorization_code = true,
        mandatory_scope           = true,
        provision_key             = "provision123",
        token_expiration          = 5,
        enable_implicit_grant     = true,
      }
    }
  end)

  res.oauth2_credentials = new_blueprint(db.oauth2_credentials, function()
    return {
      name          = "oauth2 credential",
      client_secret = "secret",
    }
  end)

  local oauth_code_seq = new_sequence("oauth-code-%d")
  res.oauth2_authorization_codes = new_blueprint(db.oauth2_authorization_codes, function()
    return {
      code  = oauth_code_seq:next(),
      scope = "default",
    }
  end)

  res.oauth2_tokens = new_blueprint(db.oauth2_tokens, function()
    return {
      token_type = "bearer",
      expires_in = 1000000000,
      scope      = "default",
    }
  end)

  res.key_auth_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "key-auth",
      config = {},
    }
  end)

  local keyauth_key_seq = new_sequence("keyauth-key-%d")
  res.keyauth_credentials = new_blueprint(db.keyauth_credentials, function()
    return {
      key = keyauth_key_seq:next(),
    }
  end)

  local keyauth_enc_key_seq = new_sequence("keyauth-enc-key-%d")
  res.keyauth_enc_credentials = new_blueprint(db.keyauth_enc_credentials, function()
    return {
      key = keyauth_enc_key_seq:next(),
    }
  end)

  res.keyauth_enc_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "key-auths-enc",
      config = {},
    }
  end)

  res.basicauth_credentials = new_blueprint(db.basicauth_credentials, function()
    return {}
  end)

  res.hmac_auth_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "hmac-auth",
      config = {},
    }
  end)

  local hmac_username_seq = new_sequence("hmac-username-%d")
  res.hmacauth_credentials = new_blueprint(db.hmacauth_credentials, function()
    return {
      username = hmac_username_seq:next(),
      secret   = "secret",
    }
  end)

  res.rate_limiting_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "rate-limiting",
      config = {},
    }
  end)

  res.response_ratelimiting_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "response-ratelimiting",
      config = {},
    }
  end)

  res.datadog_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "datadog",
      config = {},
    }
  end)

  res.statsd_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "statsd",
      config = {},
    }
  end)

  local workspace_name_seq = new_sequence("workspace-name-%d")
  res.workspaces = new_blueprint(db.workspaces, function()
    return {
      name = workspace_name_seq:next(),
    }
  end)

  res.rewriter_plugins = new_blueprint(db.plugins, function()
    return {
      name   = "rewriter",
      config = {},
    }
  end)

  local rbac_user_name_seq = new_sequence("rbac_user-%d")
  local rbac_user_user_token_seq = new_sequence("rbac_user_token-%d")
  res.rbac_users = new_blueprint(db.rbac_users, function()
    return {
      name = rbac_user_name_seq:next(),
      user_token = rbac_user_user_token_seq:next(),
    }
  end)

  local rbac_roles_seq = new_sequence("rbac_role-%d")
  res.rbac_roles = new_blueprint(db.rbac_roles, function()
    return {
      name = rbac_roles_seq:next(),
    }
  end)

  local rbac_users_seq = new_sequence("rbac_user-%d")
  res.rbac_users = new_blueprint(db.rbac_users, function()
    return {
      name = rbac_users_seq:next(),
    }
  end)

  local key_sets_seq = new_sequence("key-sets-%d")
  res.key_sets = new_blueprint(db.key_sets, function()
    return {
      name = key_sets_seq:next(),
    }
  end)
  local keys_seq = new_sequence("keys-%d")
  res.keys = new_blueprint(db.keys, function()
    return {
      name = keys_seq:next(),
    }
  end)

  return res
end


return _M
