#!/usr/bin/env bash

# ensure to source this file, not run it
export KONG_ENFORCE_RBAC=on
export KONG_ADMIN_GUI_AUTH=basic-auth
export KONG_ADMIN_GUI_SESSION_CONF='{"secret":"pongo","storage":"kong","cookie_secure":false}'
export KONG_ADMIN_GUI_URL=http://localhost:8002/

echo "RBAC and GUI-auth have been enabled, restart Kong for it to take effect"
echo "  GUI user: 'kong_admin'"
echo "  GUI pwd : '$KONG_PASSWORD'"
echo "  GUI url : '$KONG_ADMIN_GUI_URL'   (use 'pongo expose' to access the GUI from the host)"
echo ""
echo "The password should also to be used as 'Kong-Admin-Token' on API requests."
