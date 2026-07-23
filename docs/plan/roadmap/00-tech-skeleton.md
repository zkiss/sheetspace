# Phase 0: Technical Skeleton

## Goal

Establish the build, application, persistence, and test foundation needed for product work.

This phase records the foundation already delivered before the MVP. It is historical context, not active implementation scope.

## Delivered Foundation

- Keep the frontend and backend in one monorepo.
- Use a React and TypeScript frontend built with Vite.
- Use a Kotlin backend built with Ktor.
- Coordinate setup, tests, compilation, frontend distribution, and the combined build through the root Makefile.
- Support Vite-based frontend development against the backend and a production frontend bundle served by the backend.
- Provide backend database integration for durable application state.
- Establish frontend and backend unit and integration test infrastructure.

## Completion Signal

- `make setup` prepares the project.
- `make test` runs the repository test suites.
- `make compile` verifies frontend and backend compilation.
- `make frontend-dist` builds the production frontend bundle.
- `make build` produces the combined application build.

## References

- [PROJECT_VISION.md](../PROJECT_VISION.md)
- [01-mvp.md](01-mvp.md)
