FROM debian:bookworm-slim

# Pin the luamqtt version and fetch a tarball instead of `git clone`.
# An anonymous clone from GitHub fails in CI when git falls back to a
# credential prompt ("could not read Username"). curl retries instead.
ARG LUAMQTT_VERSION=3.5.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends lua5.3 lua-socket lua-filesystem curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* \
  && mkdir -p /usr/share/lua/5.3/mqtt \
  && curl -fsSL --retry 5 --retry-delay 3 --retry-connrefused --connect-timeout 20 \
       "https://codeload.github.com/xHasKx/luamqtt/tar.gz/refs/tags/v${LUAMQTT_VERSION}" \
       -o /tmp/luamqtt.tar.gz \
  && tar -xzf /tmp/luamqtt.tar.gz -C /usr/share/lua/5.3/mqtt \
       --strip-components=2 "luamqtt-${LUAMQTT_VERSION}/mqtt" \
  && rm -f /tmp/luamqtt.tar.gz

WORKDIR /app
COPY mqtt-listener.lua .
CMD ["lua5.3", "mqtt-listener.lua"]
