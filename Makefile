.DEFAULT_GOAL := build

.PHONY: build frontend backend

build:
	$(MAKE) -C backend test compile
	$(MAKE) -C frontend test build
	$(MAKE) -C backend sync-frontend

frontend:
	$(MAKE) -C frontend dev

backend:
	$(MAKE) -C backend run
