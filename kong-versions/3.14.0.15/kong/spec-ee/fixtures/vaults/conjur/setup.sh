#!/usr/bin/env bash

# initializes the conjur server instance with a test account and writes
# variables to a file so they can be consumed by test code

set -euo pipefail

readonly ACCOUNT=myConjurAccount
readonly HEALTHY=/setup/healthy
readonly ENV_FILE=/setup/env

# reset healthy status
rm -f "$HEALTHY"

readonly MOUNT=${1:?}
readonly POLICY=${MOUNT}/policy/BotApp.yml

if ! conjurctl wait; then
    rm -f "$ENV_FILE"
    exit 1
fi

# don't run our non-idempotent resource-creation steps on restart
if [[ -s $ENV_FILE ]]; then
    touch "$HEALTHY"
    exit 0
fi

admin_key=$(
    conjurctl account create "$ACCOUNT" \
    | awk '/API key/ { print $NF }'
)

test_key=$(
    conjurctl policy load "$ACCOUNT" "$POLICY" 2>&1 \
    | awk '/"api_key":/{print $NF}' \
    | tr -d '"'
)

{
    echo "CONJUR_TEST_ACCOUNT=${ACCOUNT}"
    echo "CONJUR_ADMIN_API_KEY=${admin_key:?}"
    echo "CONJUR_TEST_API_KEY=${test_key:?}"
} > "$ENV_FILE"

cat "$ENV_FILE" > "$MOUNT"/env

# record success
touch "$HEALTHY"
