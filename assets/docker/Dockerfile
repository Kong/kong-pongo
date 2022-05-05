ARG BASE=ubuntu:latest
FROM ${BASE}
FROM python:3.8.10

ARG PONGO_VERSION=master

USER root

RUN apt update \
    && apt install -y git curl docker-compose \
    && git clone https://github.com/JackRipper1888/kong-pongo.git /kong-pongo \
    && cd /kong-pongo \
    && git checkout $PONGO_VERSION

WORKDIR /pongo_wd
ENTRYPOINT ["/kong-pongo/pongo.sh"]
