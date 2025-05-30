OS := $(shell uname | awk '{print tolower($$0)}')
MACHINE := $(shell uname -m)

DEV_ROCKS = "busted 2.0.0" "busted-hjtest 0.0.4" "luacheck 0.25.0" "lua-llthreads2 0.1.6" "http 0.4" "ldoc 1.4.6"
WIN_SCRIPTS = "bin/busted" "bin/kong" "bin/kong-health"
BUSTED_ARGS ?= -v
TEST_CMD ?= bin/busted $(BUSTED_ARGS)

ifeq ($(OS), darwin)
OPENSSL_DIR ?= /usr/local/opt/openssl
GRPCURL_OS ?= osx
else
OPENSSL_DIR ?= /usr
GRPCURL_OS ?= $(OS)
endif

ifeq ($(MACHINE), aarch64)
GRPCURL_MACHINE ?= arm64
else
GRPCURL_MACHINE ?= $(MACHINE)
endif

.PHONY: install dependencies dev remove grpcurl \
	setup-ci setup-kong-build-tools \
	lint test test-integration test-plugins test-all \
	pdk-phase-check functional-tests \
	fix-windows \
	nightly-release release

ROOT_DIR:=$(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))
KONG_SOURCE_LOCATION ?= $(ROOT_DIR)
KONG_BUILD_TOOLS_LOCATION ?= $(KONG_SOURCE_LOCATION)/../kong-build-tools
KONG_GMP_VERSION ?= `grep KONG_GMP_VERSION $(KONG_SOURCE_LOCATION)/.requirements | awk -F"=" '{print $$2}'`
RESTY_VERSION ?= `grep RESTY_VERSION $(KONG_SOURCE_LOCATION)/.requirements | awk -F"=" '{print $$2}'`
RESTY_LUAROCKS_VERSION ?= `grep RESTY_LUAROCKS_VERSION $(KONG_SOURCE_LOCATION)/.requirements | awk -F"=" '{print $$2}'`
RESTY_OPENSSL_VERSION ?= `grep RESTY_OPENSSL_VERSION $(KONG_SOURCE_LOCATION)/.requirements | awk -F"=" '{print $$2}'`
RESTY_PCRE_VERSION ?= `grep RESTY_PCRE_VERSION $(KONG_SOURCE_LOCATION)/.requirements | awk -F"=" '{print $$2}'`
KONG_BUILD_TOOLS ?= `grep KONG_BUILD_TOOLS_VERSION $(KONG_SOURCE_LOCATION)/.requirements | awk -F"=" '{print $$2}'`
GRPCURL_VERSION ?= 1.8.5
OPENRESTY_PATCHES_BRANCH ?= master
KONG_NGINX_MODULE_BRANCH ?= master
KONG_PGMOON_VERSION ?= `grep KONG_PGMOON_VERSION $(KONG_SOURCE_LOCATION)/.requirements | awk -F"=" '{print $$2}'`
KONG_PGMOON_LOCATION ?= $(KONG_SOURCE_LOCATION)/../kong-pgmoon

PACKAGE_TYPE ?= deb
REPOSITORY_NAME ?= kong-${PACKAGE_TYPE}
REPOSITORY_OS_NAME ?= ${RESTY_IMAGE_BASE}
KONG_PACKAGE_NAME ?= kong
# This logic should mirror the kong-build-tools equivalent
KONG_VERSION ?= `echo $(KONG_SOURCE_LOCATION)/kong-*.rockspec | sed 's,.*/,,' | cut -d- -f2`

TAG := $(shell git describe --exact-match HEAD || true)

ifneq ($(TAG),)
	# We're building a tag
	ISTAG = true
	POSSIBLE_PRERELEASE_NAME = $(shell git describe --tags --abbrev=0 | awk -F"-" '{print $$2}')
	ifneq ($(POSSIBLE_PRERELEASE_NAME),)
		# We're building a pre-release tag
		OFFICIAL_RELEASE = false
		REPOSITORY_NAME = kong-prerelease
	else
		# We're building a semver release tag
		OFFICIAL_RELEASE = true
		KONG_VERSION ?= `cat $(KONG_SOURCE_LOCATION)/kong-*.rockspec | grep -m1 tag | awk '{print $$3}' | sed 's/"//g'`
		ifeq ($(PACKAGE_TYPE),apk)
		    REPOSITORY_NAME = kong-alpine-tar
		endif
	endif
else
	OFFICIAL_RELEASE = false
	ISTAG = false
	BRANCH ?= $(shell git rev-parse --abbrev-ref HEAD)
	REPOSITORY_NAME = kong-${BRANCH}
	REPOSITORY_OS_NAME = ${BRANCH}
	KONG_PACKAGE_NAME ?= kong-${BRANCH}
	KONG_VERSION ?= `date +%Y-%m-%d`
endif

release:
ifeq ($(ISTAG),false)
	sed -i -e '/return string\.format/,/\"\")/c\return "$(KONG_VERSION)\"' kong/meta.lua
endif
	cd $(KONG_BUILD_TOOLS_LOCATION); \
	$(MAKE) \
	KONG_VERSION=${KONG_VERSION} \
	KONG_PACKAGE_NAME=${KONG_PACKAGE_NAME} \
	package-kong && \
	$(MAKE) \
	KONG_VERSION=${KONG_VERSION} \
	KONG_PACKAGE_NAME=${KONG_PACKAGE_NAME} \
	REPOSITORY_NAME=${REPOSITORY_NAME} \
	REPOSITORY_OS_NAME=${REPOSITORY_OS_NAME} \
	KONG_PACKAGE_NAME=${KONG_PACKAGE_NAME} \
	KONG_VERSION=${KONG_VERSION} \
	OFFICIAL_RELEASE=$(OFFICIAL_RELEASE) \
	release-kong

setup-ci:
	OPENRESTY=$(RESTY_VERSION) \
	LUAROCKS=$(RESTY_LUAROCKS_VERSION) \
	OPENSSL=$(RESTY_OPENSSL_VERSION) \
	OPENRESTY_PATCHES_BRANCH=$(OPENRESTY_PATCHES_BRANCH) \
	KONG_NGINX_MODULE_BRANCH=$(KONG_NGINX_MODULE_BRANCH) \
	.ci/setup_env.sh

setup-kong-build-tools:
	-rm -rf $(KONG_BUILD_TOOLS_LOCATION)
	-git clone https://github.com/Kong/kong-build-tools.git $(KONG_BUILD_TOOLS_LOCATION)
	cd $(KONG_BUILD_TOOLS_LOCATION); \
	git reset --hard && git checkout $(KONG_BUILD_TOOLS); \

functional-tests: setup-kong-build-tools
	cd $(KONG_BUILD_TOOLS_LOCATION); \
	$(MAKE) setup-build && \
	$(MAKE) build-kong && \
	$(MAKE) test

install-pgmoon:
	-luarocks remove pgmoon --force
	-rm -rf $(KONG_PGMOON_LOCATION)
	-git clone https://github.com/Kong/pgmoon.git $(KONG_PGMOON_LOCATION)
	cd $(KONG_PGMOON_LOCATION); \
	git reset --hard $(KONG_PGMOON_VERSION); \
	luarocks make --force

install-kong:
	@luarocks make OPENSSL_DIR=$(OPENSSL_DIR) CRYPTO_DIR=$(OPENSSL_DIR)

install: install-kong install-pgmoon
	cd ./plugins-ee/application-registration; \
	luarocks make

remove:
	-@luarocks remove kong

remove-plugins-ee:
	scripts/enterprise_plugin.sh remove-all

dependencies: bin/grpcurl
	@for rock in $(DEV_ROCKS) ; do \
	  if luarocks list --porcelain $$rock | grep -q "installed" ; then \
	    echo $$rock already installed, skipping ; \
	  else \
	    echo $$rock not found, installing via luarocks... ; \
	    luarocks install $$rock OPENSSL_DIR=$(OPENSSL_DIR) CRYPTO_DIR=$(OPENSSL_DIR) || exit 1; \
	  fi \
	done;

bin/grpcurl:
	@curl -s -S -L \
		https://github.com/fullstorydev/grpcurl/releases/download/v$(GRPCURL_VERSION)/grpcurl_$(GRPCURL_VERSION)_$(GRPCURL_OS)_$(GRPCURL_MACHINE).tar.gz | tar xz -C bin;
	@rm bin/LICENSE

dev: remove install dependencies

lint:
	@luacheck --exclude-files ./plugins-ee/ -q .
	@!(grep -R -E -I -n -w '#only|#o' spec && echo "#only or #o tag detected") >&2
	@!(grep -R -E -I -n -w '#only|#o' spec-ee && echo "#only or #o tag detected") >&2
	@!(grep -R -E -I -n -- '---\s+ONLY' t && echo "--- ONLY block detected") >&2
	@$(KONG_SOURCE_LOCATION)/scripts/copyright-header-checker

install-plugins-ee:
	scripts/enterprise_plugin.sh install-all

try-install-plugins-ee:
	scripts/enterprise_plugin.sh install-all --ignore-errors

test:
	@$(TEST_CMD) spec/01-unit

test-ee:
	@$(TEST_CMD) spec-ee/01-unit

test-integration:
	@$(TEST_CMD) spec/02-integration

test-integration-ee:
	@$(TEST_CMD) spec-ee/02-integration

test-plugins-spec:
	@$(TEST_CMD) spec/03-plugins

test-plugins-spec-ee:
	@$(TEST_CMD) spec-ee/03-plugins

test-all:
	@$(TEST_CMD) spec/

test-all-ee:
	@$(TEST_CMD) spec-ee/

test-build-package:
	$(KONG_SOURCE_LOCATION)/dist/dist.sh build alpine

test-build-image: test-build-package
	$(KONG_SOURCE_LOCATION)/dist/dist.sh build-image alpine

test-build-pongo-deps:
	scripts/enterprise_plugin.sh build-deps

test-forward-proxy:
	scripts/enterprise_plugin.sh test forward-proxy

test-canary:
	scripts/enterprise_plugin.sh test canary

test-application-registration:
	scripts/enterprise_plugin.sh test application-registration

test-degraphql:
	scripts/enterprise_plugin.sh test degraphql

test-exit-transformer:
	scripts/enterprise_plugin.sh test exit-transformer

test-graphql-proxy-cache-advanced:
	scripts/enterprise_plugin.sh test graphql-proxy-cache-advanced

test-graphql-rate-limiting-advanced:
	scripts/enterprise_plugin.sh test graphql-rate-limiting-advanced

test-jq:
	scripts/enterprise_plugin.sh test jq

test-jwt-signer:
	scripts/enterprise_plugin.sh test jwt-signer

test-kafka-log:
	scripts/enterprise_plugin.sh test kafka-log

test-kafka-upstream:
	scripts/enterprise_plugin.sh test kafka-upstream

test-key-auth-enc:
	scripts/enterprise_plugin.sh test key-auth-enc

test-ldap-auth-advanced:
	scripts/enterprise_plugin.sh test ldap-auth-advanced

test-mocking:
	scripts/enterprise_plugin.sh test mocking

test-mtls-auth:
	scripts/enterprise_plugin.sh test mtls-auth

test-oauth2-introspection:
	scripts/enterprise_plugin.sh test oauth2-introspection

test-opa:
	scripts/enterprise_plugin.sh test opa

test-openid-connect:
	scripts/enterprise_plugin.sh test openid-connect

test-proxy-cache-advanced:
	scripts/enterprise_plugin.sh test proxy-cache-advanced

test-request-transformer-advanced:
	scripts/enterprise_plugin.sh test request-transformer-advanced

test-request-validator:
	scripts/enterprise_plugin.sh test request-validator

test-response-transformer-advanced:
	scripts/enterprise_plugin.sh test response-transformer-advanced

test-route-by-header:
	scripts/enterprise_plugin.sh test route-by-header

test-route-transformer-advanced:
	scripts/enterprise_plugin.sh test route-transformer-advanced

test-statsd-advanced:
	scripts/enterprise_plugin.sh test statsd-advanced

test-upstream-timeout:
	scripts/enterprise_plugin.sh test upstream-timeout

test-vault-auth:
	scripts/enterprise_plugin.sh test vault-auth

test-rate-limiting-advanced:
	scripts/enterprise_plugin.sh test rate-limiting-advanced

pdk-phase-checks:
	rm -f t/phase_checks.stats
	rm -f t/phase_checks.report
	PDK_PHASE_CHECKS_LUACOV=1 prove -I. t/01*/*/00-phase*.t
	luacov -c t/phase_checks.luacov
	grep "ngx\\." t/phase_checks.report
	grep "check_" t/phase_checks.report

fix-windows:
	@for script in $(WIN_SCRIPTS) ; do \
	  echo Converting Windows file $$script ; \
	  mv $$script $$script.win ; \
	  tr -d '\015' <$$script.win >$$script ; \
	  rm $$script.win ; \
	  chmod 0755 $$script ; \
	done;
