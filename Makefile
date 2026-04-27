.PHONY: setup
setup:
	make -C frontend setup
	make -C backend setup

.PHONY: compile
compile:
	make -C backend compile
	make -C frontend compile

.PHONY: test
test:
	make -C backend test
	make -C frontend test

.PHONY: server
server:
	make -C backend run

.PHONY: client
client:
	make -C frontend dev

.PHONY: frontend-dist
frontend-dist:
	make -C frontend compile
	make -C backend sync-frontend

.PHONY: build
build: test compile frontend-dist
