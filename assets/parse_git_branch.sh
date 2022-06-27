#!/bin/sh

# script used to extract git branch name for the Pongo shell command prompt

OLDPWD=$(pwd)
cd /kong-plugin 2> /dev/null || return
git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/(\1)/'
cd "$OLDPWD" 2> /dev/null || return
unset OLDPWD
