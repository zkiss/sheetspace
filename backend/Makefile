.PHONY: setup
setup:
	./gradlew --quiet dependencies

.PHONY: compile
compile:
	./gradlew --quiet build -x test

.PHONY: test
test:
	./gradlew --quiet test jacocoTestCoverageVerification

.PHONY: run
run:
	./gradlew --quiet run

.PHONY: sync-frontend
sync-frontend:
	./gradlew --quiet copyFrontendDist
