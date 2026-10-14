-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- imports
--

local mocker = require("spec.fixtures.mocker")

local mock_bedrock_embeddings = require("spec.helpers.ai.embeddings_mock").mock_bedrock_embeddings
--
-- private vars
--

--
-- private functions
--

local mock_request_router = function(_self, url, opts)
  if string.find(url, "model/.+/invoke") then
    return mock_bedrock_embeddings(opts, url)
  end

  return nil, "URL " .. url .. " is not supported by mocking"
end

local mock_request_router2 = function(_self, opts)
  local url = opts.path
  if string.find(url, "model/.+/invoke") then
    local mock_data = mock_bedrock_embeddings(opts, url)
    return {
      status = mock_data.status,
      headers = mock_data.headers,
      read_body = function()
        return mock_data.body, nil
      end
    }
  end

  return nil, "URL " .. url .. " is not supported by mocking"
end

--
-- public functions
--

local function setup(finally)
  mocker.setup(finally, {
    modules = {
      { "resty.http", {
        new = function()
          return {
            connect = function() return true end,
            request_uri = mock_request_router,
            request = mock_request_router2,
            set_keepalive = function() return true end,
            close = function() return true end,
          }
        end,
      } },
    }
  })
end

--
-- module
--

return {
  -- functions
  setup = setup,
}
