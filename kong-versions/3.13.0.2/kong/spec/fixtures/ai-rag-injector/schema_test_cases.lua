-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- Schema validation test cases for ai-rag-injector plugin
--

local _M = {}

-- Tests that expect success with default values
_M.valid_with_defaults = {
  {
    name = "empty config uses defaults",
    config = {},
    expected_defaults = {
      max_filter_clauses = 100,
      filter_mode = "compatible",
      stop_on_filter_error = false,
      consumer_identifier = "consumer_group"
    }
  },
}

-- global_acl_config test cases
_M.global_acl_config = {
  valid = {
    { name = "empty object", config = { global_acl_config = {} } },
    { name = "with allow and deny groups", config = { global_acl_config = { allow = { "group1", "group2" }, deny = { "group3" } } } },
    { name = "empty allow and deny lists", config = { global_acl_config = { allow = {}, deny = {} } } },
  },
}

-- collection_acl_config test cases
_M.collection_acl_config = {
  valid = {
    {
      name = "multiple collections with different ACLs",
      config = {
        collection_acl_config = {
          collection1 = { allow = { "group1" }, deny = { "group2" } },
          collection2 = { allow = { "group3" }, deny = {} }
        }
      }
    },
    {
      name = "empty collection applies defaults",
      config = { collection_acl_config = { collection1 = {} } },
      expected = {
        ["config.collection_acl_config.collection1.allow"] = {},
        ["config.collection_acl_config.collection1.deny"] = {}
      }
    },
  },
}

-- max_filter_clauses test cases
_M.max_filter_clauses = {
  valid = {
    { name = "default value", config = {}, expected_value = 100 },
    { name = "mid range (500)", config = { max_filter_clauses = 500 }, expected_value = 500 },
    { name = "boundary min (1)", config = { max_filter_clauses = 1 }, expected_value = 1 },
    { name = "boundary max (1000)", config = { max_filter_clauses = 1000 }, expected_value = 1000 },
  },
  invalid = {
    { name = "too low (0)", config = { max_filter_clauses = 0 }, error_field = "config.max_filter_clauses", error_pattern = "between" },
    { name = "too high (1001)", config = { max_filter_clauses = 1001 }, error_field = "config.max_filter_clauses", error_pattern = "between" },
  },
}

-- filter_mode test cases
_M.filter_mode = {
  valid = {
    { name = "default (compatible)", config = {}, expected_value = "compatible" },
    { name = "compatible", config = { filter_mode = "compatible" }, expected_value = "compatible" },
    { name = "strict", config = { filter_mode = "strict" }, expected_value = "strict" },
  },
  invalid = {
    { name = "invalid mode", config = { filter_mode = "invalid" }, error_field = "config.filter_mode", error_pattern = "expected one of" },
  },
}

-- stop_on_filter_error test cases
_M.stop_on_filter_error = {
  valid = {
    { name = "default (false)", config = {}, expected_value = false },
    { name = "true", config = { stop_on_filter_error = true }, expected_value = true },
    { name = "false", config = { stop_on_filter_error = false }, expected_value = false },
  },
}

-- consumer_identifier test cases
_M.consumer_identifier = {
  valid = {
    { name = "default (consumer_group)", config = {}, expected_value = "consumer_group" },
    { name = "consumer_id", config = { consumer_identifier = "consumer_id" }, expected_value = "consumer_id" },
    { name = "custom_id", config = { consumer_identifier = "custom_id" }, expected_value = "custom_id" },
    { name = "username", config = { consumer_identifier = "username" }, expected_value = "username" },
    { name = "consumer_group", config = { consumer_identifier = "consumer_group" }, expected_value = "consumer_group" },
  },
  invalid = {
    { name = "invalid_type", config = { consumer_identifier = "invalid_type" }, error_field = "config.consumer_identifier", error_pattern = "expected one of" },
  },
}

-- consumer_identifier with ACL combinations
_M.consumer_identifier_with_acl = {
  valid = {
    {
      name = "consumer_id with UUIDs",
      config = {
        consumer_identifier = "consumer_id",
        global_acl_config = { allow = { "uuid-1234-5678", "uuid-abcd-efgh" }, deny = {} }
      }
    },
    {
      name = "custom_id with user identifiers",
      config = {
        consumer_identifier = "custom_id",
        global_acl_config = { allow = { "user-abc", "user-xyz" }, deny = { "blocked-user" } }
      }
    },
    {
      name = "username with names",
      config = {
        consumer_identifier = "username",
        global_acl_config = { allow = { "john", "jane" }, deny = {} }
      }
    },
  },
}

-- combined full configuration test cases
_M.combined = {
  valid = {
    {
      name = "full config with consumer_group",
      config = {
        global_acl_config = { allow = { "admin" }, deny = { "guest" } },
        collection_acl_config = { sensitive_data = { allow = { "admin" }, deny = {} } },
        max_filter_clauses = 200,
        filter_mode = "strict",
        stop_on_filter_error = true,
        consumer_identifier = "consumer_group"
      }
    },
    {
      name = "full config with custom_id",
      config = {
        global_acl_config = { allow = { "user-123", "user-456" }, deny = { "blocked-user" } },
        collection_acl_config = { private = { allow = { "admin-user" }, deny = {} } },
        max_filter_clauses = 50,
        filter_mode = "strict",
        stop_on_filter_error = true,
        consumer_identifier = "custom_id"
      },
      expected = { ["config.consumer_identifier"] = "custom_id" }
    },
  },
}

return _M
