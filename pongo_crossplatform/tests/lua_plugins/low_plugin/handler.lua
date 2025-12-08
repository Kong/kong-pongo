local plugin = {
  PRIORITY = 1,
  VERSION = "0.1.0",
}

function plugin.access(conf)
  kong.response.set_header("X-Low-Plugin", "active")
end

-- Add missing lifecycle hooks and kong variable references
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
