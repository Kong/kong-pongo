-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

return [[
server {
    listen 15557;
    listen 15558 ssl;
    listen 15557 udp;

> for i = 1, #ssl_cert do
    ssl_certificate     $(ssl_cert[i]);
    ssl_certificate_key $(ssl_cert_key[i]);
> end
    ssl_protocols TLSv1.2 TLSv1.3;

    content_by_lua_block {
        local sock = assert(ngx.req.socket())
        local data = sock:receive()  -- read a line from downstream

        if string.find(data, "get_sni") then
            sock:send(ngx.var.ssl_server_name)
            sock:send("\n")
            return
        end

        if ngx.var.protocol == "TCP" then
            ngx.say(data)

        else
            sock:send(data) -- echo whatever was sent
        end
    }
}

include '*.stream_mock';

> if cluster_ssl_tunnel then
server {
    listen unix:${{SOCKET_PATH}}/${{CLUSTER_PROXY_SSL_TERMINATOR_SOCK}};

    proxy_pass ${{cluster_ssl_tunnel}};
    proxy_ssl on;
    # as we are essentially talking in HTTPS, passing SNI should default turned on
    proxy_ssl_server_name on;
> if proxy_server_ssl_verify then
    proxy_ssl_verify on;
> if lua_ssl_trusted_certificate_combined then
    proxy_ssl_trusted_certificate '${{LUA_SSL_TRUSTED_CERTIFICATE_COMBINED}}';
> end
    proxy_ssl_verify_depth 5; # 5 should be sufficient
> else
    proxy_ssl_verify off;
> end
    proxy_socket_keepalive on;
}
> end -- cluster_ssl_tunnel
]]
