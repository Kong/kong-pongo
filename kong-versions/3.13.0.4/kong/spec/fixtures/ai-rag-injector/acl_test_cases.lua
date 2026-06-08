-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- ACL evaluation test cases for ai-rag-injector plugin
--

local _M = {}

-- Consumer identifier test cases
_M.consumer_identifiers = {
  {
    identifier = "consumer_id",
    consumer = { id = "uuid-1234", username = "john", custom_id = "user-abc" },
    expected = { value = "uuid-1234", key = "uuid-1234" },
    desc = "returns consumer_id"
  },
  {
    identifier = "custom_id",
    consumer = { id = "uuid-1234", username = "john", custom_id = "user-abc" },
    expected = { value = "user-abc", key = "user-abc" },
    desc = "returns custom_id"
  },
  {
    identifier = "username",
    consumer = { id = "uuid-1234", username = "john", custom_id = "user-abc" },
    expected = { value = "john", key = "john" },
    desc = "returns username"
  },
  {
    identifier = "custom_id",
    consumer = { id = "uuid-1234", username = "john" },
    expected_empty = true,
    desc = "returns EMPTY when consumer has no custom_id"
  },
  {
    identifier = "consumer_id",
    consumer = nil,
    expected_empty = true,
    desc = "returns EMPTY when no consumer"
  },
}

-- evaluate_acl test cases
_M.evaluate_acl = {
  {
    consumer_groups = {[1] = "users", [2] = "blocked", users = "users", blocked = "blocked"},
    acl_config = { allow = { "users", "admin" }, deny = { "blocked" } },
    expected_decision = "deny",
    expected_reason = "deny list",
    desc = "denies when consumer in deny list"
  },
  {
    consumer_groups = {[1] = "users", users = "users"},
    acl_config = { allow = { "users", "admin" }, deny = {} },
    expected_decision = "allow",
    expected_reason = "allow list",
    desc = "allows when consumer in allow list"
  },
  {
    consumer_groups = {[1] = "guests", guests = "guests"},
    acl_config = { allow = { "users", "admin" }, deny = {} },
    expected_decision = "deny",
    expected_reason = "not in allow list",
    desc = "denies when allow list non-empty and consumer not in it"
  },
  {
    consumer_groups = {[1] = "users", users = "users"},
    acl_config = { allow = {}, deny = {} },
    expected_decision = "allow",
    expected_reason = "no restrictions configured",
    desc = "allows when no restrictions"
  },
  {
    consumer_groups = {[1] = "admin", [2] = "blocked", admin = "admin", blocked = "blocked"},
    acl_config = { allow = { "admin" }, deny = { "blocked" } },
    expected_decision = "deny",
    expected_reason = "deny list",
    desc = "deny takes precedence over allow"
  },
}

-- Collection ACL config test cases
_M.collection_acl_config = {
  {
    config = {
      collection_acl_config = {
        ["test-collection"] = { allow = { "admin" }, deny = { "blocked" } }
      },
      global_acl_config = { allow = { "users" }, deny = {} }
    },
    collection = "test-collection",
    expected = { allow = { "admin" }, deny = { "blocked" } },
    desc = "returns collection override when exists"
  },
  {
    config = {
      global_acl_config = { allow = { "users" }, deny = { "blocked" } }
    },
    collection = "any-collection",
    expected = { allow = { "users" }, deny = { "blocked" } },
    desc = "returns global config when no override"
  },
  {
    config = {},
    collection = "any-collection",
    expected = { allow = {}, deny = {} },
    desc = "returns allow-all when no ACL config"
  },
}

-- Run filter test cases with different identifier types
_M.run_filter = {
  {
    consumer = { id = "uuid-1234", username = "john", custom_id = "user-abc" },
    conf = {
      consumer_identifier = "consumer_id",
      global_acl_config = { allow = { "uuid-1234", "uuid-5678" }, deny = {} }
    },
    expected_authorized = true,
    desc = "allows with consumer_id identifier"
  },
  {
    consumer = { id = "uuid-1234", username = "john", custom_id = "user-abc" },
    conf = {
      consumer_identifier = "custom_id",
      global_acl_config = { allow = { "user-abc", "user-xyz" }, deny = {} }
    },
    expected_authorized = true,
    desc = "allows with custom_id identifier"
  },
  {
    consumer = { id = "uuid-1234", username = "john", custom_id = "user-abc" },
    conf = {
      consumer_identifier = "username",
      global_acl_config = { allow = { "john", "jane" }, deny = {} }
    },
    expected_authorized = true,
    desc = "allows with username identifier"
  },
  {
    consumer = { id = "uuid-1234", username = "john", custom_id = "user-abc" },
    conf = {
      consumer_identifier = "consumer_id",
      global_acl_config = { allow = { "uuid-5678", "uuid-9999" }, deny = {} }
    },
    expected_authorized = false,
    desc = "denies when consumer_id not in allow list"
  },
  {
    consumer = { id = "uuid-1234", username = "john", custom_id = "blocked-user" },
    conf = {
      consumer_identifier = "custom_id",
      global_acl_config = { allow = {}, deny = { "blocked-user" } }
    },
    expected_authorized = false,
    desc = "denies when custom_id in deny list"
  },
}

return _M
