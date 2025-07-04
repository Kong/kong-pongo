OS := $(shell uname | awk '{print tolower($$0)}')
MACHINE := $(shell uname -m)

BAZEL_REMOTE_CACHE_OPT := $(if $(BAZEL_REMOTE_CACHE),--remote_cache=$(BAZEL_REMOTE_CACHE))
LUAROCKS_OPTS ?= --server https://kong.github.io/kongrocks-dev/rocks/ OPENSSL_DIR=$(OPENSSL_DIR) YAML_DIR=$(YAML_DIR) AVRO_INCDIR=$(AVRO_INCDIR) AVRO_LIBDIR=$(AVRO_LIBDIR)
DEV_ROCKS = "busted 2.2.0" "busted-hjtest 0.0.5" "luacheck 1.2.0" "lua-llthreads2 0.1.6" "ldoc 1.5.0" "luacov 0.16.0" "lua-reqwest 0.1.1"
WIN_SCRIPTS = "bin/busted" "bin/kong" "bin/kong-health"
BUSTED_ARGS ?= -v
TEST_CMD ?= bin/busted $(BUSTED_ARGS)

BUILD_NAME ?= kong-dev
BAZEL_ARGS ?= --verbose_failures --action_env=BUILD_NAME=$(BUILD_NAME) --//:skip_webui=true  --//:skip_tools=true $(BAZEL_REMOTE_CACHE_OPT) --remote_upload_local_results=false

ifeq ($(OS), darwin)
HOMEBREW_DIR ?= /opt/homebrew
OPENSSL_DIR ?= $(shell brew --prefix)/opt/openssl
EXPAT_DIR ?= $(HOMEBREW_DIR)/opt/expat
LIBXML2_DIR ?= $(HOMEBREW_DIR)/opt/libxml2
GRPCURL_OS ?= osx
YAML_DIR ?= $(shell brew --prefix)/opt/libyaml
AVRO_LIBDIR ?= $(shell brew --prefix)/opt/avro/lib
AVRO_INCDIR ?= $(shell brew --prefix)/opt/avro/include
else
LIBRARY_PREFIX ?= /usr
OPENSSL_DIR ?= $(LIBRARY_PREFIX)
EXPAT_DIR ?= $(LIBRARY_PREFIX)
LIBXML2_DIR ?= $(LIBRARY_PREFIX)
GRPCURL_OS ?= $(OS)
YAML_DIR ?= /usr
AVRO_LIBDIR ?= /usr/local/kong/lib
AVRO_INCDIR ?= /usr/local/kong/include/avro
endif

ifeq ($(MACHINE), aarch64)
GRPCURL_MACHINE ?= arm64
H2CLIENT_MACHINE ?= arm64
else
GRPCURL_MACHINE ?= $(MACHINE)
H2CLIENT_MACHINE ?= $(MACHINE)
endif

ifeq ($(MACHINE), aarch64)
BAZELISK_MACHINE ?= arm64
else ifeq ($(MACHINE), x86_64)
BAZELISK_MACHINE ?= amd64
else
BAZELISK_MACHINE ?= $(MACHINE)
endif

.PHONY: install dev \
	sca test test-integration test-plugins test-all \
	pdk-phase-check functional-tests \
	fix-windows release test-logs

ROOT_DIR:=$(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))
KONG_SOURCE_LOCATION ?= $(ROOT_DIR)
GRPCURL_VERSION ?= 1.8.5
BAZLISK_VERSION ?= 1.25.0
H2CLIENT_VERSION ?= 0.4.4
BAZEL := $(shell command -v bazel 2> /dev/null)
VENV = /dev/null # backward compatibility when no venv is built

# Use x86_64 grpcurl v1.8.5 for Apple silicon chips
ifeq ($(GRPCURL_OS)_$(MACHINE)_$(GRPCURL_VERSION), osx_arm64_1.8.5)
GRPCURL_MACHINE = x86_64
endif

PACKAGE_TYPE ?= deb

bin/bazel:
	@curl -s -S -L \
		https://github.com/bazelbuild/bazelisk/releases/download/v$(BAZLISK_VERSION)/bazelisk-$(OS)-$(BAZELISK_MACHINE) -o bin/bazel
	@chmod +x bin/bazel

bin/grpcurl:
	@curl -s -S -L \
		https://github.com/fullstorydev/grpcurl/releases/download/v$(GRPCURL_VERSION)/grpcurl_$(GRPCURL_VERSION)_$(GRPCURL_OS)_$(GRPCURL_MACHINE).tar.gz | tar xz -C bin;
	@$(RM) bin/LICENSE

bin/h2client:
	@curl -s -S -L \
		https://github.com/Kong/h2client/releases/download/v$(H2CLIENT_VERSION)/h2client_$(H2CLIENT_VERSION)_$(OS)_$(H2CLIENT_MACHINE).tar.gz | tar xz -C bin;
	@$(RM) bin/README.md

install-rust-toolchain:
	@if command -v cargo; then \
		echo "Rust is already installed in the local directory, skipping"; \
	else \
		echo "Installing Rust..."; \
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path; \
		. $$HOME/.cargo/env; \
		rustup toolchain install stable; \
		rustup default stable; \
	fi

check-bazel: bin/bazel
ifndef BAZEL
	$(eval BAZEL := bin/bazel)
endif

build-cache: check-bazel
	$(BAZEL) build //build:cacheable-targets $(BAZEL_REMOTE_CACHE_OPT)

build-kong: check-bazel
	$(BAZEL) build //build:kong $(BAZEL_ARGS)

build-venv: check-bazel
	$(eval VENV := bazel-bin/build/$(BUILD_NAME)-venv.sh)

	@if [ ! -e bazel-bin/build/$(BUILD_NAME)-venv.sh ]; then \
		$(BAZEL) build //build:venv $(BAZEL_ARGS); \
	fi

build-openresty: check-bazel

	@if [ ! -e bazel-bin/build/$(BUILD_NAME)/openresty ]; then \
		$(BAZEL) build //build:install-openresty --verbose_failures --action_env=BUILD_NAME=$(BUILD_NAME); \
	else \
		$(BAZEL) build //build:dev-make-openresty --verbose_failures --action_env=BUILD_NAME=$(BUILD_NAME); \
	fi

install-dev-rocks: build-venv
	@. $(VENV) ;\
	export PATH=$$PATH:$$HOME/.cargo/bin; \
	for rock in $(DEV_ROCKS) ; do \
	  if luarocks list --porcelain $$rock | grep -q "installed" ; then \
		echo $$rock already installed, skipping ; \
	  else \
		echo $$rock not found, installing via luarocks... ; \
		LIBRARY_PREFIX=$$(pwd)/bazel-bin/build/$(BUILD_NAME)/kong ; \
		luarocks install $$rock $(LUAROCKS_OPTS) || exit 1; \
	  fi \
	done;

dev: install-rust-toolchain build-venv install-dev-rocks bin/grpcurl bin/h2client

build-release: check-bazel
	$(BAZEL) clean --expunge
	$(BAZEL) build //build:kong --verbose_failures --config release

package/deb: check-bazel build-release
	$(BAZEL) build --config release :kong_deb

package/rpm: check-bazel build-release
	$(BAZEL) build --config release :kong_el8 --action_env=RPM_SIGNING_KEY_FILE --action_env=NFPM_RPM_PASSPHRASE
	$(BAZEL) build --config release :kong_aws2 --action_env=RPM_SIGNING_KEY_FILE --action_env=NFPM_RPM_PASSPHRASE
	$(BAZEL) build --config release :kong_aws2022 --action_env=RPM_SIGNING_KEY_FILE --action_env=NFPM_RPM_PASSPHRASE

functional-tests: dev test

install: dev
	@$(VENV) luarocks make

clean: check-bazel
	$(BAZEL) clean
	$(RM) bin/bazel bin/grpcurl bin/h2client

expunge: check-bazel
	$(BAZEL) clean --expunge
	$(RM) bin/bazel bin/grpcurl bin/h2client

sca:
	@!(grep -R -E -I -n -w '#only|#o' spec && echo "#only or #o tag detected") >&2
	@!(grep -R -E -I -n -w '#only|#o' spec-ee && echo "#only or #o tag detected") >&2
	@!(grep -R -E -I -n -- '---\s+ONLY' t && echo "--- ONLY block detected") >&2
	@$(KONG_SOURCE_LOCATION)/scripts/copyright-header-checker

update-copyright: build-venv
	bash -c 'OPENSSL_DIR=$(OPENSSL_DIR) EXPAT_DIR=$(EXPAT_DIR) $(VENV) luajit $(KONG_SOURCE_LOCATION)/scripts/update-copyright'

trigger-api-tests:
	-docker manifest inspect kong/kong-gateway-internal:${DOCKER_IMAGE_TAG} 2>&1 >/dev/null && \
		curl \
			-X POST \
			-H "Accept: application/vnd.github+json" \
			-H "Authorization: Bearer ${GITHUB_TOKEN}" \
			https://api.github.com/repos/kong/kong-api-tests/dispatches \
			-d '{"event_type":"per-commit-test","client_payload":{"docker_image":"kong/kong-gateway-internal:${DOCKER_IMAGE_TAG}"}' \

test: dev
	@$(VENV) $(TEST_CMD) spec/01-unit

test-integration: dev
	@$(VENV) $(TEST_CMD) spec/02-integration

test-plugins-spec: dev
	@$(VENV) $(TEST_CMD) spec/03-plugins

test-all: dev
	@$(VENV) $(TEST_CMD) spec/

test-ee: dev
	@$(VENV) $(TEST_CMD) spec-ee/01-unit

test-integration-ee: dev
	@$(VENV) $(TEST_CMD) spec-ee/02-integration

test-plugins-spec-ee: dev
	@$(VENV) $(TEST_CMD) spec-ee/03-plugins

test-all-ee: dev
	@$(VENV) $(TEST_CMD) spec-ee/

test-custom: dev
ifndef test_spec
	$(error test_spec variable needs to be set, i.e. make test-custom test_spec=foo/bar/baz_spec.lua)
endif
	@$(VENV) $(TEST_CMD) $(test_spec)

test-logs:
	tail -F servroot/logs/error.log

pdk-phase-checks: dev
	rm -f t/phase_checks.stats
	rm -f t/phase_checks.report
	PDK_PHASE_CHECKS_LUACOV=1 prove -I. t/01*/*/00-phase*.t
	luacov -c t/phase_checks.luacov
	grep "ngx\\." t/phase_checks.report
	grep "check_" t/phase_checks.report

test-plugins-ee:
ifndef EE_PLUGIN
	$(error "Please use make plugins-ee EE_PLUGIN=plugin-name")
endif
	scripts/enterprise_plugin.sh build-deps
	scripts/enterprise_plugin.sh test $(EE_PLUGIN)

fix-windows:
	@for script in $(WIN_SCRIPTS) ; do \
	  echo Converting Windows file $$script ; \
	  mv $$script $$script.win ; \
	  tr -d '\015' <$$script.win >$$script ; \
	  rm $$script.win ; \
	  chmod 0755 $$script ; \
	done;

# the following targets are kept for backwards compatibility
# dev is renamed to dev-legacy
remove:
	$(warning 'remove' target is deprecated, please use `make dev` instead)
	-@luarocks remove kong

dependencies: install-rust-toolchain bin/grpcurl bin/h2client
	$(warning 'dependencies' target is deprecated, this is now not needed when using `make dev`, but are kept for installation that are not built by Bazel)

	export PATH=$$PATH:$$HOME/.cargo/bin; \
	for rock in $(DEV_ROCKS) ; do \
	  if luarocks list --porcelain $$rock | grep -q "installed" ; then \
		echo $$rock already installed, skipping ; \
	  else \
		echo $$rock not found, installing via luarocks... ; \
		luarocks install $$rock $(LUAROCKS_OPTS) || exit 1; \
	  fi \
	done;

install-legacy:
	@luarocks make OPENSSL_DIR=$(OPENSSL_DIR) YAML_DIR=$(YAML_DIR) AVRO_INCDIR=$(AVRO_INCDIR) AVRO_LIBDIR=$(AVRO_LIBDIR)

dev-legacy: remove install-legacy dependencies

