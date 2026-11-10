-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- Filter translator test cases for ai-rag-injector plugin
--

local _M = {}

-- PGVector translation test cases
_M.pgvector = {
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "internal", value_type = "string" }}},
    expected = {
      where_clause = "payload->'payload'->'metadata'->>'source' = $1",
      params = {"internal"},
      param_types = {"text"}
    },
    desc = "equals operator"
  },
  {
    ast = { clauses = {{ operator = "gt", field = "date", value = "2025-01-01", value_type = "date" }}},
    expected = {
      where_clause = "(payload->'payload'->'metadata'->>'date')::date > $1::date",
      params = {"2025-01-01"},
      param_types = {"date"}
    },
    desc = "greaterThan date"
  },
  {
    ast = { clauses = {{ operator = "gte", field = "date", value = "2025-01-01", value_type = "date" }}},
    expected = {
      where_clause = "(payload->'payload'->'metadata'->>'date')::date >= $1::date"
    },
    desc = "greaterThanOrEquals date"
  },
  {
    ast = { clauses = {{ operator = "lt", field = "date", value = "2025-12-31", value_type = "date" }}},
    expected = {
      where_clause = "(payload->'payload'->'metadata'->>'date')::date < $1::date"
    },
    desc = "lessThan date"
  },
  {
    ast = { clauses = {{ operator = "lte", field = "date", value = "2025-12-31", value_type = "date" }}},
    expected = {
      where_clause = "(payload->'payload'->'metadata'->>'date')::date <= $1::date"
    },
    desc = "lessThanOrEquals date"
  },
  {
    ast = { clauses = {{ operator = "in", field = "tags", value = {"doc", "api"}, value_type = "array" }}},
    expected = {
      where_pattern = "payload%->'payload'%->'metadata'%->'tags' @> %$1::jsonb",
      param_count = 1,
      param_types = {"jsonb"},
      json_value = {"doc", "api"}
    },
    desc = "in operator for tags with JSONB"
  },
  {
    ast = { clauses = {{ operator = "in", field = "source", value = {"internal", "external"}, value_type = "string" }}},
    expected = {
      where_clause = "payload->'payload'->'metadata'->>'source' IN ($1, $2)",
      params = {"internal", "external"},
      param_types = {"text", "text"}
    },
    desc = "in operator for non-array field"
  },
  {
    ast = { clauses = {
      { operator = "eq", field = "source", value = "internal", value_type = "string" },
      { operator = "gte", field = "date", value = "2025-01-01", value_type = "date" }
    }},
    expected = {
      where_clause = "payload->'payload'->'metadata'->>'source' = $1 AND (payload->'payload'->'metadata'->>'date')::date >= $2::date",
      params = {"internal", "2025-01-01"},
      param_count = 2
    },
    desc = "multiple clauses with AND"
  },
  {
    ast = { clauses = {
      { operator = "eq", field = "source", value = "internal", value_type = "string" },
      { operator = "gte", field = "date", value = "2025-01-01", value_type = "date" },
      { operator = "in", field = "tags", value = {"doc"}, value_type = "array" }
    }},
    expected = {
      param_count = 3,
      where_pattern = "AND"
    },
    desc = "three clauses"
  },
}

-- Redis translation test cases
_M.redis = {
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "internal", value_type = "string" }}},
    expected = { query = "@source:{internal}" },
    desc = "equals operator"
  },
  {
    ast = { clauses = {{ operator = "gte", field = "score", value = 10, value_type = "number" }}},
    expected = { query = "@score:[10 +inf]" },
    desc = "greaterThanOrEquals numeric"
  },
  {
    ast = { clauses = {{ operator = "gt", field = "score", value = 10, value_type = "number" }}},
    expected = { query = "@score:[(10 +inf]" },
    desc = "greaterThan numeric (exclusive)"
  },
  {
    ast = { clauses = {{ operator = "lte", field = "score", value = 100, value_type = "number" }}},
    expected = { query = "@score:[-inf 100]" },
    desc = "lessThanOrEquals numeric"
  },
  {
    ast = { clauses = {{ operator = "lt", field = "score", value = 100, value_type = "number" }}},
    expected = { query = "@score:[-inf (100]" },
    desc = "lessThan numeric (exclusive)"
  },
  {
    ast = { clauses = {{ operator = "in", field = "tags", value = {"doc", "api"}, value_type = "array" }}},
    expected = { query = "@tags:{doc|api}" },
    desc = "in operator"
  },
  {
    ast = { clauses = {{ operator = "in", field = "tags", value = {"doc"}, value_type = "array" }}},
    expected = { query = "@tags:{doc}" },
    desc = "in operator single value"
  },
  {
    ast = { clauses = {
      { operator = "eq", field = "source", value = "internal", value_type = "string" },
      { operator = "gte", field = "score", value = 10, value_type = "number" },
      { operator = "in", field = "tags", value = {"doc", "api"}, value_type = "array" }
    }},
    expected = { query = "@source:{internal} @score:[10 +inf] @tags:{doc|api}" },
    desc = "multiple clauses"
  },
}

-- Redis injection prevention test cases
_M.redis_injection = {
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "internal}@other:{*", value_type = "string" }}},
    should_escape = {"\\}", "\\@", "\\{", "\\%*"},
    should_not_contain = "}@other:{",
    desc = "special RediSearch chars in eq"
  },
  {
    ast = { clauses = {{ operator = "in", field = "tags", value = {"doc|api", "internal"}, value_type = "array" }}},
    should_match = "doc\\|api",
    pipe_count = 2,
    desc = "pipe chars in in operator"
  },
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "test\\}@bad", value_type = "string" }}},
    should_escape = {"\\\\"},
    desc = "backslash escape sequence"
  },
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "test(bad)query", value_type = "string" }}},
    should_escape = {"\\%(", "\\%)"},
    desc = "parentheses"
  },
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = 'test"quote\'escape', value_type = "string" }}},
    should_escape = {'\\"', "\\'"},
    desc = "quotes"
  },
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "@field:{*}|[test]-", value_type = "string" }}},
    should_escape = {"\\@", "\\{", "\\}", "\\%*", "\\|", "\\%[", "\\%]", "\\%-"},
    desc = "multiple special chars"
  },
  {
    ast = { clauses = {{ operator = "in", field = "tags", value = {"tag@1", "tag{2}", "tag|3"}, value_type = "array" }}},
    should_match_all = {"tag\\@1", "tag\\{2\\}", "tag\\|3"},
    desc = "array items with special chars"
  },
  -- Whitespace escaping tests for multi-word tags
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "internal docs", value_type = "string" }}},
    should_escape = {"\\ "},
    should_match = "@source:{internal\\ docs}",
    desc = "space in eq value (multi-word tag)"
  },
  {
    ast = { clauses = {{ operator = "in", field = "tags", value = {"machine learning", "AI safety"}, value_type = "array" }}},
    should_match_all = {"machine\\ learning", "AI\\ safety"},
    pipe_count = 1,
    desc = "spaces in in operator array values"
  },
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "My Document.pdf", value_type = "string" }}},
    should_escape = {"\\ "},
    should_match = "My\\ Document",
    desc = "document name with space"
  },
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "path/to/file-name.txt", value_type = "string" }}},
    should_escape = {"\\%-"},
    desc = "file path with hyphen"
  },
  {
    ast = { clauses = {{ operator = "eq", field = "source", value = "price:$100", value_type = "string" }}},
    should_match_all = {"price\\:", "\\$100"},
    desc = "value with colon and dollar sign"
  },
}

-- BaseTranslator utility test cases
_M.base_translator = {
  date_conversion = {
    valid = {
      { input = "2025-01-01", desc = "valid ISO8601" },
    },
    invalid = {
      { input = "invalid-date", error = "failed to convert date", desc = "invalid date" },
    },
  },
}

return _M
