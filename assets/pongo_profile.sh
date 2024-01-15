#!/bin/bash
#shebang above is only for ShellCheck linter purposes

# This is the profile script located in /etc/profile.d/pongo_profile.sh
# It can be used to customise the `pongo shell` behaviour.

alias ks='kong restart'
alias kp='kong stop'
alias kms='/pongo/kong_migrations_start.sh'
alias kdbl='/pongo/kong_start_dbless.sh'
alias kx='/pongo/kong_export.sh'
alias kauth='. /pongo/kong_setup_auth.sh'

if [ -d /usr/local/share/lua/5.1/ ]; then
  ln -s /usr/local/share/lua/5.1/ /rockstree
fi

# enable the dbless-reload plugin for auto reloading on plugin/config changes
if [ "$KONG_PLUGINS" != "" ]; then
  export KONG_PLUGINS=$KONG_PLUGINS,dbless-reload
else
  export KONG_PLUGINS=dbless-reload
fi
echo "Kong auto-reload is enabled for custom-plugins and dbless-configurations. Once you"
echo "have started Kong, it will automatically reload to reflect any changes in the files."
echo "Use 'pongo tail' on the host to verify, or do 'export KONG_RELOAD_CHECK_INTERVAL=0' in"
echo "this shell to disable it."

# We want this to output without expanding variables
# shellcheck disable=SC2016
echo 'PS1="\[\e[00m\]\[\033[1;34m\][$PS1_KONG_VERSION:\[\e[91m\]$PS1_REPO_NAME\$(/pongo/parse_git_branch.sh)\[\033[1;34m\]:\[\033[1;92m\]\w\[\033[1;34m\]]$\[\033[00m\] "' >> /root/.bashrc

echo ""
echo "Get started quickly with the following aliases/shortcuts:"
echo "  kms   - kong migrations start; wipe/initialize the database and start Kong clean,"
echo "          optionally importing declarative configuration if available."
echo "  kdbl  - kong start dbless; start Kong in dbless mode, requires a declarative configuration."
echo "  ks    - kong start; starts Kong with the existing database contents (actually a restart)."
echo "  kp    - kong stop; stop Kong."
echo "  kx    - export the current Kong database to a declarative configuration file."
echo "  kauth - setup authentication (RBAC and GUI-auth)."
echo ""
