-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- Metadata validation test cases for ai-rag-injector plugin
--

local _M = {}

-- validate_date test cases
_M.validate_date = {
  valid = {
    { input = "2025-01-01T10:00:00Z", desc = "valid ISO8601" },
    { input = "2025-01-01T00:00:00Z", desc = "valid ISO8601 date-only format" },
    { input = "1850-06-15T12:00:00Z", desc = "old date" },
    { input = "2999-12-31T23:59:59Z", desc = "future date" },
    { input = "0001-01-01T00:00:00Z", desc = "year 1" },
    { input = "9999-12-31T23:59:59Z", desc = "year 9999" },
  },
  invalid = {
    { input = "invalid", error = "invalid date format", desc = "invalid string" },
    { input = "2025-01-01T10:00:00", error = "invalid", desc = "missing timezone indicator" },
    { input = 12345, error = "must be a string", desc = "non-string number" },
    { input = nil, error = "must be a string", desc = "nil value" },
  },
}

-- validate_tags test cases
_M.validate_tags = {
  valid = {
    { input = {"tag1", "tag2"}, desc = "valid array" },
    { input = {"single"}, desc = "single tag" },
    { input = {}, desc = "empty array" },
    { input = {"中文", "日本語", "한글"}, desc = "UTF-8 tags" },
  },
  invalid = {
    { input = {"tag1", "tag1"}, error = "duplicate", desc = "duplicate tags" },
    { input = {123, "tag2"}, error = "must be a string", desc = "non-string element" },
    { input = {"tag1", true, "tag3"}, error = "must be a string", desc = "mixed types" },
    { input = {tag1 = "value1", tag2 = "value2"}, error = "array", desc = "non-array table" },
    { input = "not an array", error = "must be an array", desc = "non-table string" },
  },
}

-- validate_collection test cases
_M.validate_collection = {
  valid = {
    { input = "my_collection", desc = "valid collection name" },
    { input = "收藏", desc = "UTF-8 collection names" },
    { input = "collection-with-dashes_and_underscores", desc = "special characters" },
    { input = string.rep("a", 255), desc = "maximum length" },
  },
  invalid = {
    { input = "", error = "cannot be empty", desc = "empty string" },
    { input = string.rep("a", 256), error = "too long", desc = "too long" },
    { input = 123, error = "must be a string", desc = "non-string" },
  },
}

-- validate_source test cases
_M.validate_source = {
  valid = {
    { input = "https://example.com/doc.pdf", desc = "valid source URL" },
    { input = "文档来源.pdf", desc = "UTF-8 source" },
    { input = "My Document (v2.0) - Final.pdf", desc = "spaces and special chars" },
    { input = string.rep("a", 1000), desc = "maximum length" },
  },
  invalid = {
    { input = string.rep("a", 1001), error = "too long", desc = "too long" },
    { input = {}, error = "must be a string", desc = "non-string table" },
  },
}

-- validate (combined) test cases
_M.validate = {
  valid = {
    {
      input = { source = "doc.pdf", date = "2025-01-01T10:00:00Z", tags = {"tag1", "tag2"}, collection = "my_collection" },
      desc = "all fields"
    },
    {
      input = { source = "doc.pdf", collection = "my_collection" },
      desc = "partial fields"
    },
    {
      input = { collection = "test" },
      desc = "only collection"
    },
  },
  invalid = {
    { input = {}, error = "collection is required", desc = "empty metadata" },
    { input = "not a table", error = "must be a table", desc = "non-table" },
    { input = { collection = "test", date = "invalid-date" }, error = "invalid date format", desc = "invalid date field" },
    { input = { collection = "test", tags = {"tag1", "tag1"} }, error = "duplicate", desc = "duplicate tags" },
    { input = { collection = "" }, error = "cannot be empty", desc = "empty collection" },
    { input = { collection = "test", source = string.rep("a", 1001) }, error = "too long", desc = "source too long" },
  },
}

-- sanitize test cases
_M.sanitize = {
  valid = {
    {
      input = { source = "  test.pdf  " },
      expected = { source = "test.pdf" },
      desc = "trims source whitespace"
    },
    {
      input = { collection = " my_collection " },
      expected = { collection = "my_collection" },
      desc = "trims collection whitespace"
    },
    {
      input = { date = "2025-01-01T10:00:00Z" },
      expected = { date = "2025-01-01T10:00:00Z" },
      desc = "preserves date unchanged"
    },
    {
      input = { tags = {"tag1", "tag2", "tag1", "tag3"} },
      expected = { tags = {"tag1", "tag2", "tag3"} },
      desc = "deduplicates tags"
    },
    {
      input = { tags = {" tag1 ", "tag2", "  tag3  "} },
      expected_tags = {"tag1", "tag2", "tag3"},
      desc = "trims tags"
    },
    {
      input = { tags = {"tag1", "  ", "tag2", ""} },
      expected_tags = {"tag1", "tag2"},
      desc = "removes empty tags"
    },
    {
      input = {},
      expected = {},
      desc = "handles empty metadata"
    },
    {
      input = {
        source = "  doc.pdf  ",
        date = "2025-01-01T10:00:00Z",
        tags = {" tag1 ", "tag2", " tag1 ", "  ", "tag3"},
        collection = " collection "
      },
      expected = {
        source = "doc.pdf",
        date = "2025-01-01T10:00:00Z",
        collection = "collection"
      },
      expected_tags = {"tag1", "tag2", "tag3"},
      desc = "complex metadata"
    },
  },
  invalid = {
    { input = "not a table", error = "must be a table", desc = "non-table input" },
  },
}

return _M
