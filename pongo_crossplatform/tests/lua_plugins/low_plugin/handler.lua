local plugin = {
  PRIORITY = 1,
  VERSION = "0.1.0",
}

function plugin.access(conf)
  kong.response.set_header("X-Low-Plugin", "active")
end

return plugin
