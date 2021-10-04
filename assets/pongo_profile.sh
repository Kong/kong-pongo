#!/bin/sh
#shebang above is only for ShellCheck linter purposes

# This is the profile script located in /etc/profile.d/pongo_profile.sh
# It can be used to customise the `pongo shell` behaviour.

alias la='ls -A'
alias ll='ls -alF'

alias ks='kong restart'
alias kp='kong stop'
alias kms='kong stop;
           kong migrations bootstrap --force &&
           if [ -e /kong-plugin/kong.yaml ]; then
             echo $'\''\nFound "kong.yaml", importing declarative config...'\'';
             kong config db_import /kong-plugin/kong.yaml;
           else
             echo $'\''\nDeclarative file "kong.yaml" not found, skipping import'\'';
           fi &&
           kong start'

PS1="\[\e[00m\]\[\033[1;34m\][$PS1_KONG_VERSION:\[\033[1;92m\]\w\[\033[1;34m\]]#\[\033[00m\] "
