#!/usr/bin/env bash

function logo {
    local BLUE='\033[0;36m'
    local BROWN='\033[1;33m'
    echo -e "${BLUE}"
    echo -e "                ${BROWN}/~\\ ${BLUE}"
    echo -e "  ______       ${BROWN}C oo${BLUE}"
    echo -e "  | ___ \      ${BROWN}_( ^)${BLUE}"
    echo -e "  | |_/ /__  _${BROWN}/${BLUE}__ ${BROWN}~\ ${BLUE}__   ___"
    echo -e "  |  __/ _ \| '_ \ ${BROWN}/${BLUE} _ \`|/ _ \\"
    echo -e "  | | | (_) | | | | (_| | (_) |"
    echo -e "  \_|  \___/|_| |_|\__, |\___/"
    echo -e "                    __/ |"
    echo -e "                   |___/  ${BROWN}v$PONGO_VERSION"
    echo -e "\033[0m"
}

logo
