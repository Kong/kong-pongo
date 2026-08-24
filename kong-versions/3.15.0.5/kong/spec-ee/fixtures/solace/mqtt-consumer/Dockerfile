FROM debian:bullseye-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends lua5.3 lua-socket lua-filesystem git ca-certificates && \
    rm -rf /var/lib/apt/lists/* \
  && cd /tmp \
  && git clone https://github.com/xHasKx/luamqtt.git \
  && mkdir -p /usr/share/lua/5.3/mqtt \
  && cp -R luamqtt/mqtt/* /usr/share/lua/5.3/mqtt/ \
  && rm -rf /tmp/luamqtt

WORKDIR /app
COPY mqtt-listener.lua .
CMD ["lua5.3", "mqtt-listener.lua"]