local plugin = {
  PRIORITY = 10,
  VERSION = "0.2.0",
}

function plugin.access(conf)
  -- Medium complexity: add header, check query, block if missing
  local req = kong.request
  local val = req.get_query_arg("token")
  if not val or val == "" then
    return kong.response.exit(401, { message = "Missing token" })
  end
  kong.response.set_header("X-Plugin-Token", val)
end

function plugin.init_worker()
  local _ = kong.ctx
  local _ = kong.request
  local _ = kong.response
  local _ = kong.service
  local _ = kong.log
  local _ = kong.db
  local _ = kong.configuration
  local _ = kong.router
  local _ = kong.cache
  local _ = kong.cluster
  local _ = kong.worker_events
end

function plugin.header_filter(conf)
end

function plugin.body_filter(conf)
end

function plugin.log(conf)
end

function plugin.certificate(conf)
end

function plugin.rewrite(conf)
end

return plugin
