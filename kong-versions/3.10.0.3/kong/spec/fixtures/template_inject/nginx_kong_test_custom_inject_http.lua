-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

return [[
lua_shared_dict kong_mock_upstream_loggers  10m;

> if role ~= "data_plane" then
    server {
        server_name mock_upstream;

        listen 15555 reuseport;
        listen 15556 ssl reuseport;

> for i = 1, #ssl_cert do
        ssl_certificate     $(ssl_cert[i]);
        ssl_certificate_key $(ssl_cert_key[i]);
> end
        ssl_protocols TLSv1.2 TLSv1.3;

        set_real_ip_from 127.0.0.1;

        location / {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                ngx.status = 404
                return mu.send_default_json_response()
            }
        }

        location = / {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.send_default_json_response({
                    valid_routes = {
                        ["/ws"]                         = "Websocket echo server",
                        ["/get"]                        = "Accepts a GET request and returns it in JSON format",
                        ["/xml"]                        = "Returns a simple XML document",
                        ["/post"]                       = "Accepts a POST request and returns it in JSON format",
                        ["/response-headers?:key=:val"] = "Returns given response headers",
                        ["/cache/:n"]                   = "Sets a Cache-Control header for n seconds",
                        ["/anything"]                   = "Accepts any request and returns it in JSON format",
                        ["/request"]                    = "Alias to /anything",
                        ["/json/:charset"]              = "Responds with content-type application/json charset=<charset>",
                        ["/delay/:duration"]            = "Delay the response for <duration> seconds",
                        ["/basic-auth/:user/:pass"]     = "Performs HTTP basic authentication with the given credentials",
                        ["/status/:code"]               = "Returns a response with the specified <status code>",
                        ["/stream/:num"]                = "Stream <num> chunks of JSON data via chunked Transfer Encoding",
                        ["/timestamp"]                  = "Returns server timestamp in header",
                    },
                })
            }
        }

        location = /ws {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.serve_web_sockets()
            }
        }

        location = /ws/log {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.retrieve_ws_log()
            }
        }

        location /get {
            access_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.filter_access_by_method("GET")
            }
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.send_default_json_response()
            }
        }

        location /xml {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                local xml = [=[
                  <?xml version="1.0" encoding="UTF-8"?>
                    <note>
                      <body>Kong, Monolith destroyer.</body>
                    </note>
                ]=]
                return mu.send_text_response(xml, "application/xml")
            }
        }

        location /post {
            access_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.filter_access_by_method("POST")
            }
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.send_default_json_response()
            }
        }

        location = /response-headers {
            access_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.filter_access_by_method("GET")
            }
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.send_default_json_response({}, ngx.req.get_uri_args(0))
            }
        }

        location = /timestamp {
            content_by_lua_block {
                local ts = ngx.now()
                ngx.header["Server-Time"] = ts
                ngx.exit(200)
            }
        }

        location = /hop-by-hop {
            content_by_lua_block {
                local header = ngx.header
                header["Keep-Alive"]          = "timeout=5, max=1000"
                header["Proxy"]               = "Remove-Me"
                header["Proxy-Connection"]    = "close"
                header["Proxy-Authenticate"]  = "Basic"
                header["Proxy-Authorization"] = "Basic YWxhZGRpbjpvcGVuc2VzYW1l"
                header["Content-Length"]      = nil
                header["TE"]                  = "trailers, deflate;q=0.5"
                header["Trailer"]             = "Expires"
                header["Upgrade"]             = "example/1, foo/2"

                ngx.print("hello\r\n\r\nExpires: Wed, 21 Oct 2015 07:28:00 GMT\r\n\r\n")
                ngx.exit(200)
            }
        }

        location ~ "^/cache/(?<n>\d+)$" {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.send_default_json_response({}, {
                    ["Cache-Control"] = "public, max-age=" .. ngx.var.n,
                })
            }
        }

        location ~ "^/basic-auth/(?<username>[a-zA-Z0-9_]+)/(?<password>.+)$" {
            access_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.filter_access_by_basic_auth(ngx.var.username,
                                                      ngx.var.password)
            }
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.send_default_json_response({
                    authenticated = true,
                    user          = ngx.var.username,
                })
            }
        }

        location ~ "^/(request|anything)" {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.send_default_json_response()
            }
        }

        location ~ "^/bad_json$" {
          content_by_lua_block {
            local mu = require "spec.fixtures.mock_upstream"
            return mu.send_text_response('{"foo": }', "application/json")
          }
        }

        location ~ "^/json/(?<charset>[a-zA-Z0-9_-]+)$" {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                local charset = ngx.var.charset or "UTF-8"
                return mu.send_default_json_response(nil, {["Content-Type"] = "application/json; charset="..charset})
            }
        }

        location ~ "^/delay/(?<delay_seconds>\d{1,3})$" {
            content_by_lua_block {
                local mu            = require "spec.fixtures.mock_upstream"
                local delay_seconds = tonumber(ngx.var.delay_seconds)
                if not delay_seconds then
                    return ngx.exit(ngx.HTTP_NOT_FOUND)
                end

                ngx.sleep(delay_seconds)

                return mu.send_default_json_response({
                    delay = delay_seconds,
                })
            }
        }

        location ~ "^/status/(?<code>\d{3})$" {
            content_by_lua_block {
                local mu   = require "spec.fixtures.mock_upstream"
                local code = tonumber(ngx.var.code)
                if not code then
                    return ngx.exit(ngx.HTTP_NOT_FOUND)
                end
                ngx.status = code
                return mu.send_default_json_response({
                  code = code,
                })
            }
        }

        location ~ "^/stream/(?<num>\d+)$" {
            content_by_lua_block {
                local mu  = require "spec.fixtures.mock_upstream"
                local rep = tonumber(ngx.var.num)
                local res = require("cjson").encode(mu.get_default_json_response())

                ngx.header["X-Powered-By"] = "mock_upstream"
                ngx.header["Content-Type"] = "application/json"

                for i = 1, rep do
                  ngx.say(res)
                end
            }
        }

        location ~ "^/post_log/(?<logname>[a-z0-9_]+)$" {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.store_log(ngx.var.logname)
            }
        }

        location ~ "^/post_auth_log/(?<logname>[a-z0-9_]+)/(?<username>[a-zA-Z0-9_]+)/(?<password>.+)$" {
            access_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.filter_access_by_basic_auth(ngx.var.username,
                                                      ngx.var.password)
            }
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.store_log(ngx.var.logname)
            }
        }

        location ~ "^/read_log/(?<logname>[a-z0-9_]+)$" {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.retrieve_log(ngx.var.logname)
            }
        }

        location ~ "^/count_log/(?<logname>[a-z0-9_]+)$" {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.count_log(ngx.var.logname)
            }
        }

        location ~ "^/reset_log/(?<logname>[a-z0-9_]+)$" {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.reset_log(ngx.var.logname)
            }
        }

        location = /echo_sni {
            return 200 'SNI=$ssl_server_name\n';
        }

        location = /ocsp {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.handle_ocsp()
            }
        }

        location = /set_ocsp {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                return mu.set_ocsp(ngx.var.arg_status)
            }
        }

        location = /counter/inc {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                mu.increment_counter(ngx.var.arg_counter)
            }
        }

        location = /counter/read {
            content_by_lua_block {
                local mu = require "spec.fixtures.mock_upstream"
                mu.read_counter(ngx.var.arg_counter)
            }
        }
    }
> end -- role ~= "data_plane"

    include '*.http_mock';
]]
