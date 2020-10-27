#!/bin/sh

# loop over EXPOSE
for MAPPING in $EXPOSE ; do
  PORT=$(echo "$MAPPING" | grep -o "[0-9]*$")
  echo "$PORT mapped to $MAPPING"

  # following command must go in background!
  socat "TCP-LISTEN:$PORT,fork" "TCP:$MAPPING" &
done

echo "done" > /ready

jobs
wait
