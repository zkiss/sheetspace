# Sheetspace

This repository contains a makefile-driven monorepo skeleton with:

- `frontend/`: React + TypeScript + Vite client.
- `backend/`: Kotlin + Ktor API server.
- Root `Makefile`: orchestration commands for setup, compile, test, and build.

## Commands

- `make setup`: install frontend dependencies and resolve backend dependencies.
- `make test`: run backend and frontend tests with coverage gates.
- `make compile`: compile backend and frontend artifacts.
- `make frontend-dist`: build frontend then copy `frontend/dist` into backend static resources.
- `make build`: full CI-style pipeline (`test`, `compile`, `frontend-dist`).

## Coverage reports

`make test` retains the 95% backend and frontend coverage gates and then verifies the generated
machine-readable reports. Generated output is ignored by Git.

- Backend: `backend/build/reports/jacoco/test/jacocoTestReport.xml` (JaCoCo XML). Each
  `package` plus `sourcefile` identifies a Kotlin source file under `backend/src/main/kotlin`;
  `line` elements carry line numbers and `mi`/`mb` missed-instruction and missed-branch counters.
- Frontend: `frontend/coverage/coverage-final.json` (Istanbul JSON). Top-level keys are absolute
  `frontend/src` paths; each entry's `statementMap`/`branchMap` gives source locations and its
  `s`/`b` fields provide the matching execution counters.

These formats can be consumed directly to identify gaps without parsing terminal or HTML output.
Human-readable JaCoCo/Vitest terminal output and HTML reports remain available.

## Integration model

- Frontend dev server proxies `/api` requests to `http://localhost:8080`.
- Backend exposes `/api/health`.
- Backend can bundle frontend build artifacts in `backend/src/main/resources/static` using `make frontend-dist`.
