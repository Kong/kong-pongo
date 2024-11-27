FROM alpine:3.11

ARG HTTP_PROXY
ENV HTTP_PROXY=$HTTP_PROXY

ARG HTTPS_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY

COPY entrypoint.sh /entrypoint.sh

RUN apk --no-cache --virtual add socat

ENTRYPOINT ["/entrypoint.sh"]
