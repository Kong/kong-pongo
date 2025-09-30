-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- NOTE: please update spec/fixtures/ace/daos.lua at the same time
-- when you change this file. The only difference should be
-- `generate_admin_api = true` in the fixture file for test purposes.

local typedefs = require "kong.db.schema.typedefs"

local openid_schema = require "kong.plugins.openid-connect.schema"

local fmt = string.format
local openid_fields

-- getting the config field of openid-connect plugin schema
for _, field in pairs(openid_schema.fields) do
  if field.config then
    openid_fields = field.config.fields
    break
  end
end

local AUTH_TYPES = { "openid-connect", "key-auth" }
local OIDC_SUPPORTED_AUTH_METHODS =  {
  client_credentials = true,
  bearer = true,
  session = true,
}

local null = ngx.null

local ratelimiting_schema = {
  type = "record",
  required = false,
  fields = {
    { window_size = {
        type = "array",
        required = true,
        elements = { type = "number" },
      }
    },
    { limit = {
        type = "array",
        required = true,
        elements = { type = "number" },
      }
    },
  },
}


return {
  {
    primary_key = { "id" },
    name = "ace_operations",
    workspaceable = true,
    generate_admin_api = true,
    fields = {
      { id = typedefs.uuid },
      { expression = { type = "string", required = true } },
      { priority = { type = "number", default = 0 } },
      { api_id = { type = "string", required = false }, },
      { created_at = typedefs.auto_timestamp_s },
      { updated_at = typedefs.auto_timestamp_s },
      { tags = typedefs.tags },
    },
  },
  {
    primary_key = { "id" },
    name = "ace_auth_strategies",
    workspaceable = true,
    generate_admin_api = true,
    fields = {
      { id = typedefs.uuid },
      {
        type = {
          description = "The type of authentication to be performed. Possible values are: 'openid-connect', 'key-auth'",
          required = true,
          type = "string",
          one_of = AUTH_TYPES,
        },
      },
      { config = {
        type = "record",
        required = true,
        fields = {
          { key_auth = {
            type = "record",
            required = false,
            fields = {
              { key_names = {
                  description = "The names of the headers containing the API key. You can specify multiple header names.",
                  type = "array",
                  elements = typedefs.header_name,
                  len_min = 1,
              } },
            }
          } },
          { oidc = {
            type = "record",
            required = false,
            fields = openid_fields,
          } },
        },
      } },
    },
    entity_checks = {
      { custom_entity_check = {
          field_sources = {"type", "config"},
          fn = function(entity)
            if entity.type == "key-auth" and (
              entity.config.key_auth == nil or entity.config.key_auth == null or
              entity.config.key_auth.key_names == nil or entity.config.key_auth.key_names == null or
              #entity.config.key_auth.key_names == 0
            ) then
              return nil, "when ace_auth_strategy type is 'key_auth' the config.key_auth.key_names has to be defined"
            end

            if entity.type == "openid-connect" then
              if entity.config.oidc == nil or entity.config.oidc == ngx.null then
                return nil, "when ace_auth_strategy type is 'openid-connect' the config.oidc has to be defined"
              end

              if entity.config.oidc.auth_methods ~= nil then
                for _, method in ipairs(entity.config.oidc.auth_methods) do
                  if not OIDC_SUPPORTED_AUTH_METHODS[method] then
                    return nil, fmt("'%s' auth_method within openid connect is not supported when using ACE", method)
                  end
                end
              end
            end

            return true
          end
      } }
    }
  },
  {
    primary_key = { "id" },
    name = "ace_credentials",
    workspaceable = true,
    generate_admin_api = true,
    cache_key = { "auth_strategy", "api_key_hash", "client_id" },
    fields = {
      { id = typedefs.uuid },
      {
        api_key_hash = {
          description = "The hash of apikey",
          type = "string",
          unique = true,
        },
      },
      {
        client_id = {
          description = "The hash of apikey",
          type = "string",
          unique = true,
        },
      },
      { auth_strategy = { type = "foreign", required = true, reference = "ace_auth_strategies", on_delete = "cascade" }, },
      { portal_id = { type = "string", required = false }, },
      { application_id = { type = "string", required = false }, },
      { organization_id = { type = "string", required = false }, },
    },
  },
  {
    primary_key = { "id" },
    name = "ace_operation_groups",
    workspaceable = true,
    generate_admin_api = true,
    fields = {
      { id = typedefs.uuid },
      { ratelimiting = ratelimiting_schema },
      { entity_id = { type = "string", required = false }, },
      { entity_type = { type = "string", required = false }, },
      { created_at = typedefs.auto_timestamp_s },
      { updated_at = typedefs.auto_timestamp_s },
      { tags = typedefs.tags },
    },
  },
  {
    primary_key = { "id" },
    name = "ace_operation_groups_operations",
    workspaceable = true,
    generate_admin_api = true,
    cache_key = {"operation_group", "operation"},
    fields = {
      { id = typedefs.uuid },
      { operation_group = { type = "foreign", required = true, reference = "ace_operation_groups", on_delete = "cascade" } },
      { operation = { type = "foreign", required = true, reference = "ace_operations", on_delete = "cascade" } },
      { ratelimiting = ratelimiting_schema },
      { created_at = typedefs.auto_timestamp_s },
      { updated_at = typedefs.auto_timestamp_s },
      { tags = typedefs.tags },
    },
  },
  {
    primary_key = { "id" },
    name = "ace_operation_groups_credentials",
    workspaceable = true,
    generate_admin_api = true,
    cache_key = { "operation_group", "credential" },
    fields = {
      { id = typedefs.uuid },
      { operation_group = { type = "foreign", required = true, reference = "ace_operation_groups", on_delete = "cascade" } },
      { credential = { type = "foreign", required = true, reference = "ace_credentials", on_delete = "cascade" } },
      { created_at = typedefs.auto_timestamp_s },
      { updated_at = typedefs.auto_timestamp_s },
      { tags = typedefs.tags },
    },
  },
}
