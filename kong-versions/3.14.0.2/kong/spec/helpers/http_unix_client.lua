-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


local http = require("resty.http")
local lfs = require "lfs"


local setmetatable = setmetatable


local DEFAULT_TIMEOUT = 60000


local _M = setmetatable({}, { __index = http })
local _MT = { __index = _M }


function _M.new(options)
  local opts = options or {}

  opts.scheme = opts.scheme or "http"

  local socket_path = opts.socket_path
  assert(lfs.attributes(socket_path, "mode") == "socket",
    "socket_path is not a unix socket: " .. socket_path)
  opts.host = "unix:" .. opts.socket_path
  opts.socket_path = nil

  assert(opts.port == nil, "port should not be set for Unix socket connections")

  local self = setmetatable(assert(http.new()), _MT)

  local connect_timeout = opts.connect_timeout or opts.timeout or DEFAULT_TIMEOUT
  local send_timeout = opts.send_timeout or opts.timeout or DEFAULT_TIMEOUT
  local read_timeout = opts.read_timeout or opts.timeout or DEFAULT_TIMEOUT
  self:set_timeouts(connect_timeout, send_timeout, read_timeout)

  opts.ssl_verify = opts.ssl_verify == true or false
  opts.ssl_server_name = opts.sni or opts.ssl_server_name
  opts.sni = nil

  assert(self:connect(opts))

  self.options = opts
  return self
end


function _M:request(options)
  local opts = options or {}

  opts.version = opts.http_version or self.options.http_version or "1.1"
  opts.http_version = nil
  opts.method = opts.method or "GET"
  opts.path = opts.path or "/"

  return http.request(self, opts)
end


function _M:close()
  return http.close(self)
end


return _M

