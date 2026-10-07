-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]
local zlib = require "ffi-zlib"

local gzip_state = {}

local function gzip_input(bufsize)
  if gzip_state.idx > #gzip_state.data then
    return nil
  end

  local chunk = gzip_state.data:sub(gzip_state.idx, gzip_state.idx + bufsize - 1)
  gzip_state.idx = gzip_state.idx + bufsize
  return chunk
end

local function gzip_output(out)
  gzip_state.output[#gzip_state.output + 1] = out
end

local function gzip_data(data)
  gzip_state = {
    data = data,
    idx = 1,
    output = {},
  }

  zlib.deflateGzip(gzip_input, gzip_output)
  return table.concat(gzip_state.output)
end

return {
  gzip_data = gzip_data,
}
