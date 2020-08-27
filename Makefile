install:
	mkdir -p ~/.local/bin
	ln -sf $$(pwd)/pongo.sh ~/.local/bin/pongo
	if [ ! "$$(command -v pongo)" = "$$(command -v ~/.local/bin/pongo)" ]; then \
		echo "\033[0;33m[INFO] please add ~/.local/bin/ to your system path \033[0m"; \
		echo "\033[0;33m[INFO]    export PATH=~/.local/bin/:"'$$'"PATH\033[0m"; \
	fi

lint:
	bash -c 'shopt -s globstar nullglob; shellcheck **/*.{sh,ksh,bash}'
