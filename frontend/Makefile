.PHONY: setup
setup:
	npm install

.PHONY: compile
ifneq ($(filter test,$(MAKECMDGOALS)),)
# The same invocation's successful coverage run includes architecture tests.
# No persistent marker or environment bypass can affect standalone compilation.
compile: test
	npm run build:assets
else
compile:
	npm run build
endif

.PHONY: test
test:
	npm run test:coverage

.PHONY: dev
dev:
	npm run dev
