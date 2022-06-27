#!/bin/sh
#shebang above is only for ShellCheck linter purposes

# This is the profile script located in /etc/profile.d/pongo_profile.sh
# It can be used to customise the `pongo shell` behaviour.

alias la='ls -A'
alias ll='ls -alF'

alias ks='kong restart'
alias kp='kong stop'
alias kms='/pongo/kong_migrations_start.sh'
alias kdbl='/pongo/kong_start_dbless.sh'

PS1="\[\e[00m\]\[\033[1;34m\][$PS1_KONG_VERSION:\[\e[91m\]$PS1_REPO_NAME\$(/pongo/parse_git_branch.sh)\[\033[1;34m\]:\[\033[1;92m\]\w\[\033[1;34m\]]$\[\033[00m\] "
