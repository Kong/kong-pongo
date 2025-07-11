-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local cjson_safe = require "cjson.safe"
local cjson      = require "cjson"
local ws_server  = require "resty.websocket.server"
local pl_file    = require "pl.file"
local strip      = require("kong.tools.string").strip
local splitn      = require("kong.tools.string").splitn


local kong = {
  table = require("kong.pdk.table").new()
}

local ocsp_status = "good"

local function parse_multipart_form_params(body, content_type)
  if not content_type then
    return nil, 'missing content-type'
  end

  local m, err = ngx.re.match(content_type, "boundary=(.+)", "oj")
  if not m or not m[1] or err then
    return nil, "could not find boundary in content type " .. content_type ..
                "error: " .. tostring(err)
  end

  local boundary    = m[1]
  local parts_split, parts_count = splitn(body, '--' .. boundary)
  local params      = {}
  local part, from, to, part_value, part_name, part_headers, first_header
  for i = 1, parts_count do
    part = strip(parts_split[i])

    if part ~= '' and part ~= '--' then
      from, to, err = ngx.re.find(part, '^\\r$', 'ojm')
      if err or (not from and not to) then
        return nil, nil, "could not find part body. Error: " .. tostring(err)
      end

      part_value   = part:sub(to + 2, #part) -- +2: trim leading line jump
      part_headers = part:sub(1, from - 1)
      local part_headers_t = splitn(part_headers, '\\n')
      first_header = part_headers_t[1]
      if first_header:lower():sub(1, 19) == "content-disposition" then
        local m, err = ngx.re.match(first_header, 'name="(.*?)"', "oj")

        if err or not m or not m[1] then
          return nil, "could not parse part name. Error: " .. tostring(err)
        end

        part_name = m[1]
      else
        return nil, "could not find part name in: " .. part_headers
      end

      params[part_name] = part_value
    end
  end

  return params
end


local function send_text_response(text, content_type, headers)
  headers       = headers or {}
  content_type  = content_type or "text/plain"

  text = ngx.req.get_method() == "HEAD" and "" or tostring(text)

  ngx.header["X-Powered-By"]   = "mock_upstream"
  ngx.header["Server"]         = "mock-upstream/1.0.0"
  ngx.header["Content-Length"] = #text + 1
  ngx.header["Content-Type"]   = content_type

  for header,value in pairs(headers) do
    if type(value) == "table" then
      ngx.header[header] = table.concat(value, ", ")
    else
      ngx.header[header] = value
    end
  end

  return ngx.say(text)
end


local function filter_access_by_method(method)
  if ngx.req.get_method() ~= method then
    ngx.status = ngx.HTTP_NOT_ALLOWED
    send_text_response("Method not allowed for the requested URL")
    return ngx.exit(ngx.OK)
  end
end


local function find_http_credentials(authorization_header)
  if not authorization_header then
    return
  end

  local iterator, iter_err = ngx.re.gmatch(authorization_header,
                                           "\\s*[Bb]asic\\s*(.+)")
  if not iterator then
    ngx.log(ngx.ERR, iter_err)
    return
  end

  local m, err = iterator()

  if err then
    ngx.log(ngx.ERR, err)
    return
  end

  if m and m[1] then
    local decoded_basic = ngx.decode_base64(m[1])

    if decoded_basic then
      local user_pass = splitn(decoded_basic, ":", 3)
      return user_pass[1], user_pass[2]
    end
  end
end


local function filter_access_by_basic_auth(expected_username,
                                           expected_password)
   local headers = ngx.req.get_headers(0)

   local username, password =
   find_http_credentials(headers["proxy-authorization"])

   if not username then
     username, password =
     find_http_credentials(headers["authorization"])
   end

   if username ~= expected_username or password ~= expected_password then
     ngx.header["WWW-Authenticate"] = "mock_upstream"
     ngx.header["X-Powered-By"]     = "mock_upstream"
     return ngx.exit(ngx.HTTP_UNAUTHORIZED)
   end
end


local function get_ngx_vars()
  local var = ngx.var
  return {
    uri                = var.uri,
    host               = var.host,
    hostname           = var.hostname,
    https              = var.https,
    scheme             = var.scheme,
    is_args            = var.is_args,
    server_addr        = var.server_addr,
    server_port        = var.server_port,
    server_name        = var.server_name,
    server_protocol    = var.server_protocol,
    remote_addr        = var.remote_addr,
    remote_port        = var.remote_port,
    realip_remote_addr = var.realip_remote_addr,
    realip_remote_port = var.realip_remote_port,
    binary_remote_addr = var.binary_remote_addr,
    request            = var.request,
    request_uri        = var.request_uri,
    request_time       = var.request_time,
    request_length     = var.request_length,
    request_method     = var.request_method,
    bytes_received     = var.bytes_received,
    ssl_server_name    = var.ssl_server_name or "no SNI",
  }
end


local function get_body_data()
  local req   = ngx.req

  req.read_body()
  local data  = req.get_body_data()
  if data then
    return data
  end

  local file_path = req.get_body_file()
  if file_path then
    local file = io.open(file_path, "r")
    data       = file:read("*all")
    file:close()
    return data
  end

  return ""
end

local function get_post_data(content_type)
  local text   = get_body_data()
  local kind   = "unknown"
  local params = cjson_safe.null
  local err

  if type(content_type) == "string" then
    if content_type:find("application/x-www-form-urlencoded", nil, true) then

      kind        = "form"
      params, err = ngx.req.get_post_args(0)

    elseif content_type:find("multipart/form-data", nil, true) then
      kind        = "multipart-form"
      params, err = parse_multipart_form_params(text, content_type)

    elseif content_type:find("application/json", nil, true) then
      kind        = "json"
      params, err = cjson_safe.decode(text)
    end

    params = params or cjson_safe.null

    if err then
      kind = kind .. " (error)"
      err  = tostring(err)
    end
  end

  return { text = text, kind = kind, params = params, error = err }
end


local function get_default_json_response()
  local headers = ngx.req.get_headers(0)
  local vars    = get_ngx_vars()

  return {
    headers   = headers,
    post_data = get_post_data(headers["Content-Type"]),
    url       = ("%s://%s:%s%s"):format(vars.scheme, vars.host,
                                        vars.server_port, vars.request_uri),
    uri_args  = ngx.req.get_uri_args(0),
    vars      = vars,
  }
end


local function send_default_json_response(extra_fields, response_headers)
  local tbl = kong.table.merge(get_default_json_response(), extra_fields)
  local ctype = response_headers and response_headers["Content-Type"] or "application/json"
  return send_text_response(cjson.encode(tbl), ctype, response_headers)
end


local function serve_web_sockets()
  local wb, err = ws_server:new({
    timeout         = 5000,
    max_payload_len = 65535,
  })

  if not wb then
    ngx.log(ngx.ERR, "failed to open websocket: ", err)
    return ngx.exit(444)
  end

  while true do
    local data, typ, err = wb:recv_frame()
    if wb.fatal then
      ngx.log(ngx.ERR, "failed to receive frame: ", err)
      return ngx.exit(444)
    end

    if data then
      if typ == "close" then
        break
      end

      if typ == "ping" then
        local bytes, err = wb:send_pong(data)
        if not bytes then
          ngx.log(ngx.ERR, "failed to send pong: ", err)
          return ngx.exit(444)
        end

      elseif typ == "pong" then
        ngx.log(ngx.INFO, "client ponged")

      elseif typ == "text" then
        local bytes, err = wb:send_text(data)
        if not bytes then
          ngx.log(ngx.ERR, "failed to send text: ", err)
          return ngx.exit(444)
        end
      end

    else
      local bytes, err = wb:send_ping()
      if not bytes then
        ngx.log(ngx.ERR, "failed to send ping: ", err)
        return ngx.exit(444)
      end
    end
  end

  wb:send_close()
end


local function get_logger()
  local logger = ngx.shared.kong_mock_upstream_loggers
  if not logger then
    error("missing 'kong_mock_upstream_loggers' shm declaration")
  end

  return logger
end


local function store_log(logname)
  ngx.req.read_body()

  local raw_entries = ngx.req.get_body_data()
  local logger = get_logger()

  local entries = cjson.decode(raw_entries)
  if #entries == 0 then
    -- backwards-compatibility for `conf.queue_size == 1`
    entries = { entries }
  end

  local log_req_params = ngx.req.get_uri_args()
  local log_req_headers = ngx.req.get_headers(0)

  for i = 1, #entries do
    local store = {
      entry = entries[i],
      log_req_headers = log_req_headers,
      log_req_params = log_req_params,
    }

    assert(logger:rpush(logname, cjson.encode(store)))
    assert(logger:incr(logname .. "|count", 1, 0))
  end

  ngx.status = 200
end


local function retrieve_log(logname)
  local logger = get_logger()
  local len = logger:llen(logname)
  local entries = {}

  for i = 1, len do
    local encoded_stored = assert(logger:lpop(logname))
    local stored = cjson.decode(encoded_stored)
    entries[i] = stored.entry
    entries[i].log_req_headers = stored.log_req_headers
    entries[i].log_req_params = stored.log_req_params
    assert(logger:rpush(logname, encoded_stored))
  end

  local count, err = logger:get(logname .. "|count")
  if err then
    error(err)
  end

  ngx.status = 200
  ngx.say(cjson.encode({
    entries = entries,
    count = count,
  }))
end


local function count_log(logname)
  local logger = get_logger()
  local count = assert(logger:get(logname .. "|count"))

  ngx.status = 200
  ngx.say(count)
end


local function reset_log(logname)
  local logger = get_logger()
  logger:delete(logname)
  logger:delete(logname .. "|count")
end


local function handle_ocsp()
  if ocsp_status == "good" then
    ngx.print(pl_file.read(ngx.config.prefix() .. "/../spec/fixtures/ocsp_certs/resp-good.dat"))

  elseif ocsp_status == "revoked" then
    ngx.print(pl_file.read(ngx.config.prefix() .. "/../spec/fixtures/ocsp_certs/resp-revoked.dat"))

  elseif ocsp_status == "error" then
    ngx.exit(500)

  else
    assert("unknown ocsp_status:" ..ocsp_status)
  end
end


local function set_ocsp(status)
  ocsp_status = status
end

local function increment_counter(key)
  if not key or key == "" then
    return ngx.exit(400)
  end
  local shm = get_logger()
  shm:incr("counter::" .. key, 1, 0, 60)
end

local function read_counter(key)
  if not key or key == "" then
    return ngx.exit(400)
  end
  local shm = get_logger()
  local count = shm:get("counter::" .. key)
  ngx.header["Content-Type"] = "application/json"
  ngx.print(cjson.encode({ count = count }))
end


return {
  get_default_json_response   = get_default_json_response,
  filter_access_by_method     = filter_access_by_method,
  filter_access_by_basic_auth = filter_access_by_basic_auth,
  send_text_response          = send_text_response,
  send_default_json_response  = send_default_json_response,
  serve_web_sockets           = serve_web_sockets,
  store_log                   = store_log,
  retrieve_log                = retrieve_log,
  count_log                   = count_log,
  reset_log                   = reset_log,
  handle_ocsp                 = handle_ocsp,
  set_ocsp                    = set_ocsp,
  increment_counter           = increment_counter,
  read_counter                = read_counter,
}
