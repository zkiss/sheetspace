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

## Integration model

- Frontend dev server proxies `/api` requests to `http://localhost:8080`.
- Backend exposes `/api/health`.
- Backend can bundle frontend build artifacts in `backend/src/main/resources/static` using `make frontend-dist`.
