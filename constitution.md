# Sheetspace coding constitution

Follow these rules for all coding and testing work in Sheetspace. Repository workflow, delivery, and documentation scope are defined in [AGENTS.md](AGENTS.md).

## Design and organization

- Use the simplest design that meets current requirements. Add complexity for concrete benefits such as better testability, clearer responsibilities, or measured performance needs. Avoid premature optimization, overengineering, and abstractions for hypothetical future needs.
- Prefer tools’ defaults and conventions when they meet requirements. Configure only what needs to differ, using the simplest, shortest clear form that expresses the intended behavior.
- Apply DRY and SOLID to concrete responsibilities: centralize repeated knowledge and behavior, keep interfaces focused, and separate application logic from infrastructure. These principles should simplify the design, not add unnecessary layers.
- Prefer composition over inheritance: assemble behavior from focused collaborators.
- Organize classes into cohesive packages by responsibility or feature. Keep package boundaries clear and implementation details private where practical.
- Keep production and test files small, cohesive, and focused on one responsibility.
- Separate calculation, validation, data transformation, and other application logic from UI rendering and interaction code so that logic can be tested without rendering the app.

## Readability and comments

- Write code that reads like English through clear names, focused functions, and straightforward control flow. Improve the code rather than adding comments to explain what it does.
- Use comments only for rationale the code cannot convey, such as a library bug or non-obvious external behavior. Explain the constraint and why the chosen approach is necessary; do not restate the code.

## Dependency boundaries and libraries

- Encapsulate external operations and hard-to-test infrastructure in dedicated adapters behind simple, focused interfaces. Application logic should depend on those interfaces.
- Inject dependencies so tests can replace adapters with mocks or in-memory substitutes without changing application logic.
- Use libraries when their intended purpose is to implement the capability needed. Do not import a broad or unrelated library solely for an incidental side feature.

## Testing

Write test function bodies so they read like English sentences describing the setup, action, and expected outcome. Extract setup or assertion logic into clearly named helpers when it obscures that narrative, keeping the behavior under test visible in the test body.

### Unit and integration tests

- Prefer fast, isolated unit tests at the lowest practical level. Cover functional rules extensively, including edge cases, error paths, and interactions between rules.
- Split large test suites by behavior theme, including suites for the same class or component.
- Keep integration tests few and focused on wiring, boundaries, and behavior introduced by integration. Leave exhaustive rule coverage to unit tests.

### External operations

- Replace external dependencies so tests run in isolation. Use in-memory filesystems for application-level filesystem tests and local mock HTTP servers for remote endpoint calls. Do not depend on live services, machine-specific state, or uncontrolled network access.
- Assert application behavior, including its handling of dependency results and failures. Verify requests to dependency interfaces when those requests are part of the behavior being tested.
- Test real adapters separately with harmless, controlled operations and disposable resources. Keep these tests focused on the adapter contract.

### UI tests

- Keep UI tests focused on presentation, user interactions, focus, selection, and wiring to application logic. Prove functional rules in lower-level tests rather than expensive rendered-app suites.
- Render only the component or smallest UI composition needed to prove the behavior. Use full-app tests only for behavior that requires full-app integration.
- Control time and animations with fake clocks and disabled or controlled animations. Use real-time waits or running animations only when necessary to prove the behavior under test.

## Quality gates

- Maintain at least 95% coverage for each application's production code across the configured coverage metrics. Coverage supports behavioral testing; it does not replace meaningful assertions.
- The automated build must enforce coverage, formatting, linting, and successful compilation, and fail when any required check fails.
- Fix failures rather than weakening thresholds, disabling checks, or excluding ordinary production code to make a build pass.

## Refactoring during feature work

- Refactor when it benefits the feature under implementation. Complete straightforward cleanup in the changed code within the Deliverable's scope.
- Do not defer correctness, security, regression, acceptance-criteria, or avoidable code-quality problems in the changed work.
- For broader refactoring that would materially benefit the code, create a follow-up refactor Bead. Record the source Deliverable, affected code, and concrete evidence, and give the user the Bead ID. Keep that work outside the current Deliverable unless the user expands its scope.
