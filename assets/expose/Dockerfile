FROM alpine:3.11

# add helper files to workaround some issues
COPY entrypoint.sh /entrypoint.sh

RUN apk --no-cache --virtual add socat

ENTRYPOINT ["/entrypoint.sh"]
