#!/bin/sh

mkdir -p /var/log/webhook
chmod 777 /var/log/webhook

openresty -g 'daemon off;' 2>> /tmp/startup-debug.log