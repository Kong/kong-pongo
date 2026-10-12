-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local floor = math.floor
local time = ngx.time
local ngx_sleep = ngx.sleep


-- Aligns to the start of a fixed rate-limit window, sleeping past the
-- boundary when already more than halfway through the current one (or
-- always, if force_next_window is set). A sequence of requests asserting
-- exact remaining-count decrements needs this: a window reset mid-sequence
-- makes the counts jump back up and flakes the test.
local function wait_for_next_fixed_window(window_size, force_next_window)
  local window_start = floor(time() / window_size) * window_size
  local window_elapsed_time = (time() - window_start)
  if force_next_window == true or (window_elapsed_time > (window_size / 2)) then
    ngx_sleep(window_size - window_elapsed_time)
    window_start = window_start + window_size
  end

  return window_start
end


return {
  wait_for_next_fixed_window = wait_for_next_fixed_window,
}
