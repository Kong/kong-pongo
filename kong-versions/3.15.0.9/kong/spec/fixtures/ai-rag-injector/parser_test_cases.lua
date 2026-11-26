-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- Filter parser test cases for ai-rag-injector plugin
--

local _M = {}

-- count_clauses test cases
_M.count_clauses = {
  { input = { andAll = {{}, {}, {}} }, expected = 3, desc = "counts clauses in andAll" },
  { input = nil, expected = 0, desc = "returns 0 for nil" },
  { input = {}, expected = 0, desc = "returns 0 for empty filter" },
  { input = { other = {} }, expected = 0, desc = "returns 0 when andAll missing" },
  { input = { andAll = "not-a-table" }, expected = 0, desc = "returns 0 when andAll not table" },
}

-- Operator validation test cases
_M.operators = {
  valid = {
    { op = "equals", field = "source", value = "internal", desc = "equals on string field" },
    { op = "equals", field = "collection", value = "col1", desc = "equals on collection" },
    { op = "greaterThan", field = "date", value = "2025-01-01", desc = "greaterThan on date" },
    { op = "lessThan", field = "date", value = "2025-12-31", desc = "lessThan on date" },
    { op = "greaterThanOrEquals", field = "date", value = "2025-01-01", desc = "gte on date" },
    { op = "lessThanOrEquals", field = "date", value = "2025-12-31", desc = "lte on date" },
    { op = "in", field = "tags", value = {"tag1", "tag2"}, desc = "in on tags" },
  },
  invalid = {
    { op = "greaterThan", field = "source", value = "value", error = "not valid for field type", desc = "greaterThan on string" },
    { op = "equals", field = "date", value = "invalid-date", error = "invalid date", desc = "invalid date format" },
    { op = "in", field = "tags", value = "not-array", error = "requires array", desc = "in without array" },
    { op = "equals", field = "unknown_field", value = "value", error = "unknown metadata field", desc = "unknown field" },
    { op = "unknownOp", field = "source", value = "value", error = "unsupported operator", desc = "unknown operator" },
    { op = "equals", field = "source", value = 123, error = "requires string value", desc = "non-string value" },
  },
}

-- Parse test cases - valid
_M.parse_valid = {
  {
    filter = { andAll = {{ equals = { key = "source", value = "internal" }}}},
    expected = { clause_count = 1, first = { operator = "eq", field = "source", value = "internal", value_type = "string" }},
    desc = "equals operator"
  },
  {
    filter = { andAll = {{ greaterThan = { key = "date", value = "2025-01-01" }}}},
    expected = { clause_count = 1, first = { operator = "gt", field = "date", value = "2025-01-01", value_type = "date" }},
    desc = "greaterThan date"
  },
  {
    filter = { andAll = {{ lessThan = { key = "date", value = "2025-12-31" }}}},
    expected = { clause_count = 1, first = { operator = "lt", value_type = "date" }},
    desc = "lessThan date"
  },
  {
    filter = { andAll = {{ greaterThanOrEquals = { key = "date", value = "2025-01-01" }}}},
    expected = { clause_count = 1, first = { operator = "gte" }},
    desc = "greaterThanOrEquals date"
  },
  {
    filter = { andAll = {{ lessThanOrEquals = { key = "date", value = "2025-12-31" }}}},
    expected = { clause_count = 1, first = { operator = "lte" }},
    desc = "lessThanOrEquals date"
  },
  {
    filter = { andAll = {{ ["in"] = { key = "tags", value = {"doc", "api"} }}}},
    expected = { clause_count = 1, first = { operator = "in", value_type = "array", value = {"doc", "api"} }},
    desc = "in operator with array"
  },
  {
    filter = { andAll = {
      { equals = { key = "source", value = "internal" }},
      { greaterThan = { key = "date", value = "2025-01-01" }},
      { ["in"] = { key = "tags", value = {"doc"} }}
    }},
    expected = {
      clause_count = 3,
      clauses = {
        { operator = "eq", field = "source" },
        { operator = "gt", field = "date" },
        { operator = "in", field = "tags" }
      }
    },
    desc = "multiple clauses"
  },
}

-- Parse test cases - invalid
_M.parse_invalid = {
  { filter = "not-a-table", error = "filter must be a table", desc = "non-table filter" },
  { filter = { equals = {} }, error = "must contain 'andAll'", desc = "missing andAll" },
  { filter = { andAll = "not-a-table" }, error = "'andAll' must be an array", desc = "andAll not table" },
  { filter = { andAll = {} }, error = "cannot be empty", desc = "empty andAll" },
  { filter = { andAll = {{ notAnOperator = { key = "source", value = "val" }}}}, error = "unknown operator.*notAnOperator", desc = "unknown operator" },
  {
    filter = { andAll = {{ equals = { key = "source", value = "val" }, greaterThan = { key = "date", value = "2025-01-01" }}}},
    error = "must have exactly one operator",
    desc = "multiple operators in clause"
  },
  { filter = { andAll = { "not-a-table" }}, error = "clause at index 1 must be a table", desc = "clause not a table" },
  { filter = { andAll = {{ equals = "not-a-table" }}}, error = "operator value at index 1 must be a table", desc = "operator value not table" },
  { filter = { andAll = {{ equals = { value = "val" }}}}, error = "missing 'key'", desc = "missing key" },
  { filter = { andAll = {{ equals = { key = "source" }}}}, error = "missing 'value'", desc = "missing value" },
  { filter = { andAll = {{ greaterThan = { key = "source", value = "val" }}}}, error = "not valid for field type", desc = "invalid operator for field" },
  { filter = { andAll = {{ equals = { key = "date", value = "not-a-date" }}}}, error = "invalid date", desc = "invalid date format" },
  {
    filter = { andAll = {
      { equals = { key = "source", value = "valid" }},
      { greaterThan = { key = "source", value = "invalid" }}
    }},
    error = "clause at index 2",
    desc = "error includes clause index"
  },
  -- Array size validation tests (DoS prevention)
  {
    filter = (function()
      local huge_array = {}
      for i = 1, 1001 do
        huge_array[i] = "tag" .. i
      end
      return { andAll = {{ ["in"] = { key = "tags", value = huge_array }}}}
    end)(),
    error = "array exceeds maximum element count.*1001 > 1000",
    desc = "array with >1000 elements"
  },
  {
    filter = { andAll = {{ ["in"] = { key = "tags", value = {string.rep("x", 257)} }}}},
    error = "array element at index 1 exceeds maximum size.*257 > 256",
    desc = "array element >256 bytes"
  },
  {
    filter = (function()
      -- Create 1000 elements of 263 bytes each = 263,000 total bytes (exceeds 256KB)
      local large_array = {}
      for i = 1, 1000 do
        large_array[i] = string.rep("x", 263)
      end
      return { andAll = {{ ["in"] = { key = "tags", value = large_array }}}}
    end)(),
    error = "array element at index 1 exceeds maximum size.*263 > 256",
    desc = "array element size exceeded before total size check"
  },
}

-- max_filter_clauses test cases
_M.max_clauses = {
  {
    count = 101,
    max = 100,
    should_fail = true,
    error = "exceeds max_filter_clauses.*101 > 100",
    desc = "exceeds limit"
  },
  {
    count = 100,
    max = 100,
    should_fail = false,
    desc = "at limit"
  },
}

-- Edge cases
_M.edge_cases = {
  {
    filter = { andAll = {{ equals = { key = "source", value = "" }}}},
    expected_value = "",
    desc = "empty string values"
  },
  {
    filter = { andAll = {{ ["in"] = { key = "tags", value = {} }}}},
    expected_value = {},
    desc = "empty array for in operator"
  },
  {
    filter = { andAll = {{ ["in"] = { key = "tags", value = {"single"} }}}},
    expected_value = {"single"},
    desc = "single element array"
  },
  {
    filter = (function()
      local max_valid_array = {}
      for i = 1, 1000 do
        max_valid_array[i] = "tag" .. i
      end
      return { andAll = {{ ["in"] = { key = "tags", value = max_valid_array }}}}
    end)(),
    expected_value = (function()
      local max_valid_array = {}
      for i = 1, 1000 do
        max_valid_array[i] = "tag" .. i
      end
      return max_valid_array
    end)(),
    desc = "array with exactly 1000 elements (at limit)"
  },
  {
    filter = { andAll = {{ ["in"] = { key = "tags", value = {string.rep("x", 256)} }}}},
    expected_value = {string.rep("x", 256)},
    desc = "array element with exactly 256 bytes (at limit)"
  },
  {
    filter = { andAll = {{ ["in"] = { key = "tags", value = {"multi word tag", "another tag", "simple"} }}}},
    expected_value = {"multi word tag", "another tag", "simple"},
    desc = "array with multi-word values"
  },
}

return _M
