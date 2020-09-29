install:
	mkdir -p ~/.local/bin
	ln -sf $$(pwd)/pongo.sh ~/.local/bin/pongo
	if [ ! "$$(command -v pongo)" = "$$(command -v ~/.local/bin/pongo)" ]; then \
		echo -e "\033[0;33m[INFO] please add ~/.local/bin/ to your system path \033[0m"; \
		echo -e "\033[0;33m[INFO]    export PATH=~/.local/bin/:"'$$'"PATH\033[0m"; \
	fi

lint:
	bash -c 'shopt -s globstar nullglob &> /dev/null; shellcheck **/*.{sh,ksh,bash}'

test:
	assets/ci/test.sh --suite "Pongo test suite"
