-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Filesystem-installed custom plugin used exclusively by
-- spec-ee/02-integration/21-profiling/05-chunk-tag_spec.lua.
--
-- The chunk-tag classifier stamps this handler proto with tag "custom".
-- During the profile window the CPU sampler must observe at least one
-- frame carrying that tag; `busy` is marked jit.off so samples land on
-- the interpreter path where debug.getinfo(th, i, ...) reliably reports
-- this chunk's proto. If `busy` were JIT'd, the trace could root outside
-- this chunk (Kong core's plugin dispatcher) and every sample would
-- attribute to that outer proto with tag "-".

local ChunkTagCustom = {
  VERSION  = "1.0.0",
  PRIORITY = 990,  -- below key-auth (1250) so authentication runs first
}

local function busy(iters)
  local s = 0
  for i = 1, iters do s = s + (i * 1.0001) % 7 end
  return s
end
jit.off(busy)

function ChunkTagCustom:access(conf)
  local _ = busy(conf.iters or 50000)
end

return ChunkTagCustom
