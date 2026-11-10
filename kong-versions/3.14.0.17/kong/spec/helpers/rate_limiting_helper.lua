-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local floor = math.floor
local ngx_now = ngx.now
local ngx_sleep = ngx.sleep
local update_time = ngx.update_time

-- Sleep past the next window tick (or the current one if already past
-- halfway, or always when force_next_window is set). ngx.time() is
-- integer, so sleeping exactly to the boundary can leave the next
-- request in the old window and flake remaining-count asserts.
local WINDOW_ALIGN_MARGIN = 0.1


local function wait_for_next_fixed_window(window_size, force_next_window)
  update_time()
  local now = ngx_now()
  local window_start = floor(now / window_size) * window_size
  local window_elapsed_time = now - window_start
  if force_next_window == true or (window_elapsed_time > (window_size / 2)) then
    ngx_sleep(window_size - window_elapsed_time + WINDOW_ALIGN_MARGIN)
    window_start = window_start + window_size
  end

  return window_start
end


return {
  wait_for_next_fixed_window = wait_for_next_fixed_window,
}
