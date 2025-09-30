FROM alpine:latest

RUN apk add --no-cache lua5.3 lua5.3-socket lua5.3-filesystem git \
  && cd /tmp \
  && git clone https://github.com/xHasKx/luamqtt.git \
  && mkdir -p /usr/share/lua/5.3/mqtt \
  && cp -R luamqtt/mqtt/* /usr/share/lua/5.3/mqtt/ \
  && rm -rf /tmp/luamqtt

WORKDIR /app
COPY mqtt-listener.lua .
CMD ["lua5.3", "mqtt-listener.lua"]