tech:
- separate backend and frontend
- typescript frontend with vite
- backend: unsure, what would you suggest? I'm thinking kotlin
- unit tests are essential, 90% coverage
- client + server in one repo
- use make to coordinate build: see ../kb-codex for makefile-driven fe+backend build orchestration and also for how i want the frontend and backend to integrate. fe: works with vite -> backend but also i can build fe and backend can use it and serve it when built.