local plugin = {
  PRIORITY = 100,
  VERSION = "0.1.0",
}

function plugin.access(conf)
  local val = kong.request.get_query_arg("token")
  if val == "admin" then
    kong.response.set_header("X-High-Plugin", "admin-mode")
  else
    kong.response.set_header("X-High-Plugin", "user-mode")
  end
end

return plugin
