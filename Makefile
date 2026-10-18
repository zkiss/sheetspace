.DEFAULT_GOAL := build

.PHONY: build frontend backend test-tools

build: test-tools
	$(MAKE) -C backend test compile
	$(MAKE) -C frontend test build
	$(MAKE) -C backend sync-frontend

frontend:
	$(MAKE) -C frontend dev

backend:
	$(MAKE) -C backend run

test-tools:
	bash tools/tests/quota-run-test
