.PHONY: install
install:
	npm install
	npm run setup:browser

.PHONY: build
build: install
	npm run build

.PHONY: test
test: install
	npm run test:coverage

.PHONY: dev
dev:
	npm run dev
