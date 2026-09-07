# glue-app/Makefile
#
# Build, test, lint, and scan targets for the NC Glue App (architecture.md
# § ⑨): a thin Nextcloud PHP app bridging Nextcloud's internal APIs and the
# ExApp containers in Nextcloud mode. Holds no Doc-Mgr shard/queue
# credentials — see db.md § Nextcloud-DB Glue-App Tables.
#
# Requires php-cli (>=8.1), composer, and an Xdebug or PCOV build for
# coverage on the host/image (see docker/Dockerfile.ci). OCP (Nextcloud's
# public API) is provided by the Nextcloud runtime at deployment and is
# never a composer dependency; unit tests instead autoload a small
# hand-written stub of the exact OCP surface this app uses (tests/stubs/OCP,
# dev-only — see composer.json "autoload-dev").
#
# Also builds and tests the Vue app shell (frontend.md § Integration Model,
# M4.1) that this PHP app mounts: `src/` (Vue + Vue Router, Vitest
# `*.unit.test.ts`) is built by Vite into `js/momentum-main.js`, the bundle
# `templates/index.php`'s `script()` call resolves at runtime. Requires
# node/npm alongside the PHP toolchain above.
#
# CONTRACT TARGETS (binding for dark-factory workers)
# ---------------------------------------------------
# fmt lint build unit-tests integration-tests tests coverage
# pre-commit pre-push sbom scan clean

SHELL := /usr/bin/env bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := build
.DELETE_ON_ERROR:

PHP      := php
COMPOSER := composer
NPM      := npm

VENDOR_STAMP := vendor/composer/installed.json
NODE_STAMP   := node_modules/.install-stamp
SBOM         := sbom.cyclonedx.json
VULNS        := sbom.vex.cyclonedx.json

# Combined test coverage threshold (lines %). PHP-only for now — see the
# coverage target below.
GLUE_APP_COVERAGE_THRESHOLD ?= 80

# Grype scan gate: only fail on fixable medium+.
GRYPE_GATE_FLAGS := --ignore-states not-fixed,wont-fix,unknown --fail-on medium

NPM_FLAGS := --no-audit --no-fund --loglevel warn

PHP_SOURCES := $(shell find lib -name '*.php' 2>/dev/null)
TESTS       := $(shell find tests -name '*.php' 2>/dev/null)
MANIFESTS   := composer.json composer.lock

JS_SOURCES  := $(shell find src -name '*.ts' -o -name '*.vue' 2>/dev/null | grep -v '\.test\.ts$$')
JS_TESTS    := $(shell find src -name '*.unit.test.ts' 2>/dev/null)
JS_MANIFESTS := package.json package-lock.json

# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------

pre-commit:
	@if [ -n "$$(git diff HEAD --name-only --relative)" ]; then $(MAKE) fmt lint build unit-tests; fi

PUSH_BASE := $(shell git rev-parse --verify @{push} 2>/dev/null || git rev-parse --verify origin/main 2>/dev/null || echo HEAD)
pre-push:
	@if [ -n "$$(git diff $(PUSH_BASE)...HEAD --name-only --relative)" ]; then \
	  $(MAKE) pre-commit tests coverage sbom scan; \
	fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

install: $(VENDOR_STAMP) $(NODE_STAMP)
$(VENDOR_STAMP): $(MANIFESTS)
	$(COMPOSER) install --no-interaction
	@touch $@

$(NODE_STAMP): $(JS_MANIFESTS)
	$(NPM) ci $(NPM_FLAGS)
	@touch $@

# ---------------------------------------------------------------------------
# Format + lint
# ---------------------------------------------------------------------------

# No auto-formatter wired yet (nextcloud/coding-standards ships one, but
# pulling it in is deferred to whichever milestone first needs style-fixing
# at scale). `php -l` syntax-checks every source/test file in the meantime.
# The JS side is type-checked by vue-tsc instead of a separate linter.
fmt:
	@echo "glue-app: no auto-formatter configured yet — running syntax check only."
	@$(MAKE) lint

lint: .lint-stamp
.lint-stamp: $(PHP_SOURCES) $(TESTS) $(JS_SOURCES) $(NODE_STAMP)
	@find lib tests/unit tests/stubs -name '*.php' -print0 | xargs -0 -I{} $(PHP) -l {}
	@$(NPM) exec --no -- vue-tsc --noEmit
	@touch $@

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

# PHP is interpreted and deployed as source (`composer install` is the
# closest analogue to a build step there). The Vue app shell (M4.1) needs a
# real build: Vite bundles src/ into js/momentum-main.js, the file
# templates/index.php's script() call loads at runtime. A second Vite
# invocation of the SAME config (VITE_BUILD_TARGET=files — see
# vite.config.ts's comment for why one env-var-branched config file rather
# than a second config file) produces js/momentum-files.js — the Files-app
# integration bundle (M4.14/M4.16) LoadAdditionalScriptsListener.php injects
# on every Files page; 'iife' output only supports one entry per build,
# hence two invocations.
build: $(VENDOR_STAMP) js/momentum-main.js js/momentum-files.js
	@$(PHP) -l lib/AppInfo/Application.php >/dev/null

js/momentum-main.js: $(JS_SOURCES) $(NODE_STAMP) vite.config.ts tsconfig.json
	$(NPM) exec --no -- vite build

js/momentum-files.js: $(JS_SOURCES) $(NODE_STAMP) vite.config.ts tsconfig.json
	VITE_BUILD_TARGET=files $(NPM) exec --no -- vite build

# ---------------------------------------------------------------------------
# Tests + coverage
# ---------------------------------------------------------------------------

unit-tests: .unit-tests-stamp
.unit-tests-stamp: $(PHP_SOURCES) $(TESTS) $(JS_SOURCES) $(JS_TESTS) $(VENDOR_STAMP) $(NODE_STAMP) phpunit.xml vite.config.ts
	$(PHP) vendor/bin/phpunit
	$(NPM) exec --no -- vitest run
	@touch $@

# No backing Nextcloud instance to integrate against yet — the filesystem-
# event listener lands in a later milestone (M5.2). The sync-work ledger
# drain pass (M5.3), tenant mapper/token minter (M5.4), and OCS endpoint
# (M5.8) are unit-tested against hand-written in-memory fakes instead (see
# tests/unit/Db, tests/unit/Service). Zero integration tests here is a pass,
# not a failure, mirroring the extraction/backend live-test-tier convention.
integration-tests:
	@echo "glue-app: no integration tests yet (no backing Nextcloud instance to run against)."

tests: unit-tests integration-tests
test: tests

coverage: coverage-percent.txt
coverage-percent.txt: $(PHP_SOURCES) $(TESTS) $(VENDOR_STAMP) phpunit.xml
	XDEBUG_MODE=coverage $(PHP) vendor/bin/phpunit --coverage-clover=coverage.xml
	@PCT=$$($(PHP) -r ' \
	  $$doc = new DOMDocument(); \
	  $$doc->load("coverage.xml"); \
	  $$metrics = $$doc->getElementsByTagName("metrics")->item(0); \
	  $$covered = (float) $$metrics->getAttribute("coveredstatements"); \
	  $$total = (float) $$metrics->getAttribute("statements"); \
	  echo $$total > 0 ? round($$covered / $$total * 100, 1) : 0; \
	'); \
	if awk -v p="$$PCT" -v t="$(GLUE_APP_COVERAGE_THRESHOLD)" 'BEGIN { exit !(p+0 < t+0) }'; then \
	  echo "Error: glue-app test coverage $$PCT% < GLUE_APP_COVERAGE_THRESHOLD=$(GLUE_APP_COVERAGE_THRESHOLD)%"; \
	  exit 1; \
	else \
	  printf '%s\n' "$$PCT" > $@; \
	  echo "glue-app test coverage: $$PCT%"; \
	fi

# ---------------------------------------------------------------------------
# SBOM + vulnerability scan
# ---------------------------------------------------------------------------

sbom: $(SBOM)
$(SBOM): $(MANIFESTS) $(JS_MANIFESTS) $(VENDOR_STAMP)
	# github-action(-workflow)-usage-catalogers pick up CI workflow files bundled
	# inside vendor/ dev-dependency source (e.g. vendor/phar-io/manifest's own
	# .github/workflows/ci.yml) — noise unrelated to this app's own supply chain,
	# so drop them explicitly rather than ignoring the CVEs they surface.
	syft -q dir:. --select-catalogers +php-composer-lock-cataloger,+javascript-package-cataloger,-github-actions-usage-cataloger,-github-action-workflow-usage-cataloger -o cyclonedx-json=$@

sbom-add: $(SBOM)
	@git diff --quiet $^ || (echo git add $^; git add $^)

sbom-force:
	rm -f $(SBOM) && $(MAKE) sbom

scan: $(VULNS)
$(VULNS): $(SBOM)
	@grype -q -o table sbom:$(SBOM) || true
	grype -q $(GRYPE_GATE_FLAGS) -o cyclonedx-json=$@ sbom:$(SBOM)

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------

clean:
	rm -rf vendor/ coverage.xml coverage-percent.txt .phpunit.result.cache \
	  .lint-stamp .unit-tests-stamp $(SBOM) $(VULNS) \
	  node_modules/ js/ coverage/

# ---------------------------------------------------------------------------
# Delegation aliases (root Makefile may call make sbom-glue-app in glue-app/)
# ---------------------------------------------------------------------------
%-glue-app: %

.PHONY: pre-commit pre-push install \
	fmt lint build unit-tests integration-tests tests test coverage \
	sbom sbom-add sbom-force scan clean
