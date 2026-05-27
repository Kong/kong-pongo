-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- Test data fixtures for ai-rag-injector plugin
--

local _M = {}

-- Test consumer definitions
_M.consumers = {
  {
    username = "admin_user",
    groups = {"admin"},
    key = "admin_key_123"
  },
  {
    username = "regular_user",
    groups = {"users"},
    key = "user_key_456"
  },
  {
    username = "premium_user",
    groups = {"users", "premium"},
    key = "premium_key_789"
  },
  {
    username = "guest_user",
    groups = {"guests"},
    key = "guest_key_abc"
  },
  {
    username = "blocked_user",
    groups = {"blocked"},
    key = "blocked_key_def"
  },
  {
    username = "multi_group_user",
    groups = {"users", "premium", "beta"},
    key = "multi_key_ghi"
  }
}

-- ACL configuration templates
_M.acl_configs = {
  -- Deny blocked users
  deny_blocked = {
    allow = {},
    deny = {"blocked"}
  },

  -- No ACL (allow all)
  no_acl = {
    allow = {},
    deny = {}
  }
}

-- Collection override templates
_M.collection_acl_config = {
  -- Private collection for admin only
  private_admin_only = {
    private = {
      allow = {"admin"},
      deny = {}
    }
  }
}

-- Filter test cases
_M.filters = {
  -- Invalid filter (missing andAll)
  invalid_missing_andall = {
    {equals = {key = "source", value = "internal"}}
  },

  -- Invalid filter (wrong value type for 'in')
  invalid_in_value_type = {
    andAll = {
      {["in"] = {key = "tags", value = "not-an-array"}}
    }
  }
}

-- API validation test cases
_M.api_validation = {
  -- Ingest endpoint parameter validation
  ingest_params = {
    reject = {
      {
        desc = "non-string content",
        body = { content = 12345, metadata = { collection = "test" } },
        error = "content must be provided as a string",
      },
    },
    accept = {
      {
        desc = "request without metadata",
        body = { content = "Test content without metadata" },
      },
    },
  },

  -- Ingest endpoint metadata validation
  ingest_metadata = {
    accept = {
      {
        desc = "empty tags array",
        metadata = { tags = {}, collection = "test" },
      },
      {
        desc = "metadata without collection (defaults to 'default')",
        metadata = { source = "test-source" },
      },
    },
    reject = {
      {
        desc = "very long source string",
        metadata = { source = string.rep("a", 1001), collection = "test" },
        error = "invalid metadata",
      },
    },
  },

  -- Lookup endpoint parameter validation
  lookup_params = {
    reject = {
      {
        desc = "missing prompt",
        body = { filters = { andAll = {} } },
        error = "prompt is required",
      },
      {
        desc = "non-string prompt",
        body = { prompt = 12345 },
        error = "must be string",
      },
      {
        desc = "invalid filter_mode value",
        body = { prompt = "test", filter_mode = "invalid-mode" },
        error = "must be one of",
      },
      {
        desc = "non-boolean stop_on_filter_error",
        body = { prompt = "test", stop_on_filter_error = "true" },
        error = "must be boolean",
      },
    },
    accept = {
      {
        desc = "collection filter",
        options = { collection = "specific-collection" },
      },
      {
        desc = "filter_mode override",
        options = { filter_mode = "strict" },
      },
      {
        desc = "stop_on_filter_error override",
        options = { stop_on_filter_error = true },
      },
      {
        desc = "exclude_contents flag",
        options = { exclude_contents = true },
      },
      {
        desc = "omitted filter_mode defaults to 'compatible'",
        options = {},  -- No filter_mode specified
      },
      {
        desc = "omitted stop_on_filter_error defaults to false",
        options = {},  -- No stop_on_filter_error specified
      },
    },
  },

  -- Lookup endpoint filter validation
  lookup_filters = {
    reject = {
      {
        desc = "unknown operator in strict mode",
        filter = { andAll = { { unknownOp = { key = "source", value = "test" } } } },
        error = "filter error",
      },
      {
        desc = "missing key field in strict mode",
        filter = { andAll = { { equals = { value = "test" } } } },
        error = "filter error",
      },
      {
        desc = "wrong type for 'in' operator",
        filter = { andAll = { { ["in"] = { key = "tags", value = "not-an-array" } } } },
        error = "filter error",
      },
    },
  },

  -- Error response format tests
  error_responses = {
    {
      desc = "missing content",
      endpoint = "ingest_chunk",
      body = {},
    },
    {
      desc = "missing prompt",
      endpoint = "lookup_chunks",
      body = {},
    },
    {
      desc = "invalid metadata",
      endpoint = "ingest_chunk",
      body_fn = "create_api_ingest_request",
      args = { "Test content", { date = "invalid-date", collection = "test" } },
      check_pattern = "metadata",
    },
    {
      desc = "invalid filter",
      endpoint = "lookup_chunks",
      body_fn = "create_api_lookup_request",
      args = { "Test query", { andAll = { { invalid = { x = 1 } } } }, { filter_mode = "strict" } },
      check_pattern = "filter",
    },
  },
}

-- Edge case test data
_M.edge_cases = {
  -- Empty/null filter handling
  empty_filters = {
    reject = {
      {
        desc = "empty filter object",
        filter = {},
        host = "edge-test-1.test",
      },
      {
        desc = "empty andAll array",
        filter = { andAll = {} },
        host = "edge-test-2.test",
      },
    },
    accept = {
      {
        desc = "empty string values",
        filter = { andAll = { { equals = { key = "source", value = "" } } } },
        host = "edge-test-3.test",
      },
      {
        desc = "empty tags array in IN filter",
        filter = { andAll = { { ["in"] = { key = "tags", value = {} } } } },
        host = "edge-test-4.test",
      },
    },
  },

  -- Date validation
  dates = {
    valid = {
      { input = "2024-02-29", desc = "valid leap year date" },
      { input = "1000-01-01", desc = "extreme past date" },
      { input = "9999-12-31", desc = "extreme future date" },
      { input = "2025-01-15T10:30:00Z", desc = "full ISO8601 format with timezone" },
    },
  },

  -- Special characters
  special_chars = {
    valid = {
      { field = "source", value = "文档来源", desc = "UTF-8 characters in source" },
      { field = "tags", value = {"中文", "日本語"}, desc = "UTF-8 characters in tags" },
      { field = "collection", value = "公共文档", desc = "UTF-8 characters in collection name" },
      { field = "source", value = ".*?+[]{}()|^$", desc = "regex special characters" },
      { field = "source", value = "'; DROP TABLE vectors; --", desc = "potential SQL injection" },
    },
    invalid = {
      {
        field = "source",
        value = string.char(0xFF, 0xFE),
        desc = "invalid UTF-8 bytes",
      },
    },
  },

  -- Boundary values
  boundaries = {
    valid = {
      {
        field = "source",
        value = string.rep("a", 1000),
        desc = "very long source string",
      },
      {
        field = "tags",
        value = (function()
          local tags = {}
          for i = 1, 100 do tags[i] = "tag" .. tostring(i) end
          return tags
        end)(),
        desc = "large tags array",
      },
      {
        field = "collection",
        value = string.rep("a", 255),
        desc = "very long collection name",
      },
    },
    invalid = {
      {
        field = "collection",
        value = string.rep("a", 1000),
        desc = "excessively long collection name",
        error = "collection name too long",
      },
    },
  },

  -- Malformed filter syntax
  malformed_filters = {
    {
      desc = "multiple operators in single clause",
      filter = {
        andAll = {
          {
            equals = { key = "source", value = "internal" },
            greaterThan = { key = "date", value = "2025-01-01" },
          },
        },
      },
      host = "edge-test-multi-op.test",
    },
    {
      desc = "greaterThan operator on non-date field",
      filter = {
        andAll = {
          { greaterThan = { key = "source", value = "test" } },
        },
      },
      host = "edge-test-type-mismatch.test",
    },
    {
      desc = "unknown metadata field",
      filter = {
        andAll = {
          { equals = { key = "unknown_field", value = "test" } },
        },
      },
      host = "edge-test-unknown-field.test",
    },
  },

  -- Metadata validation
  metadata_validation = {
    valid = {
      {
        metadata = { collection = "test" },
        desc = "only required field (collection)",
      },
      {
        metadata = { tags = {}, collection = "test" },
        desc = "empty tags array",
      },
    },
    invalid = {
      {
        metadata = { source = "internal", date = "2025-01-15", tags = {"test"} },
        desc = "missing collection (required field)",
      },
      {
        metadata = { tags = {"tag1", "tag1", "tag2", "tag2"}, collection = "test" },
        desc = "duplicate tags",
        error = "duplicate tag: tag1",
      },
    },
  },
}

return _M
