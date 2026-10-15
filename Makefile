# One frontend invocation owns all requested work, even for mixed/parallel goals.
# Coverage includes architecture; frontend's graph shares that assurance only
# within this invocation. Standalone compilation still runs architecture checks.
frontend-goals := $(if $(filter build test,$(MAKECMDGOALS)),test) $(if $(filter build compile frontend-dist,$(MAKECMDGOALS)),compile)
backend-goals := $(if $(filter build test,$(MAKECMDGOALS)),test) $(if $(filter build compile,$(MAKECMDGOALS)),compile) $(if $(filter build test compile frontend-dist,$(MAKECMDGOALS)),lint)

.PHONY: setup
setup:
	$(MAKE) -C frontend setup
	$(MAKE) -C backend setup

.PHONY: compile
compile: frontend-work

.PHONY: test
test: frontend-work

.PHONY: backend-work frontend-work
backend-work:
# Run Gradle requests serially; a single recursive request shares the lint prerequisite.
	$(MAKE) -C backend $(backend-goals)

frontend-work: $(if $(strip $(backend-goals)),backend-work)
	$(MAKE) -C frontend $(frontend-goals)

.PHONY: server
server:
	$(MAKE) -C backend run

.PHONY: client
client:
	$(MAKE) -C frontend dev

.PHONY: frontend-dist
frontend-dist: frontend-work
	$(MAKE) -C backend sync-frontend

.PHONY: build
build: test compile frontend-dist
