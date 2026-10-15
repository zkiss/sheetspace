.NOTPARALLEL:

.PHONY: setup
setup:
	./gradlew --quiet dependencies

.PHONY: compile
compile: lint
	./gradlew --quiet build -x test

.PHONY: test
test: lint
	./gradlew --quiet test jacocoTestCoverageVerification

.PHONY: lint
lint:
	./gradlew --quiet checkstyleMain checkstyleTest

.PHONY: run
run:
	./gradlew --quiet run

.PHONY: sync-frontend
sync-frontend:
	./gradlew --quiet copyFrontendDist
