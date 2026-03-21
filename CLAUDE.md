# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (both server + frontend in watch mode)
npm run dev

# Individual workspaces
npm run dev:server    # Fastify on http://localhost:4000
npm run dev:web       # Vite on http://localhost:5174

# Production build
npm run build         # Compiles server TS + Vite frontend build
npm start             # Run compiled server

# Type checking (no ESLint/Prettier — TypeScript is the only linter)
cd server && npx tsc --noEmit
cd web && npx tsc --noEmit

# Docker
docker compose up --build -d
```

No test framework exists in this project.

## Architecture

This is an npm workspaces monorepo (`server/` + `web/`). In production, the server serves the compiled frontend as static files from `/app/web/dist`.

### Backend (`server/src/`)

- **`index.ts`** — Fastify app entry point; registers plugins (CORS, WebSocket, static), mounts all routes, initializes DB and file watcher
- **`db/index.ts`** — SQLite via `sql.js` (browser-compatible WASM, not `better-sqlite3`). DB is loaded from `/app/data/homelab.db` at startup and written back to disk after every mutation via `saveDb()`. Exports typed query objects (`userQueries`, `projectQueries`, `sessionQueries`)
- **`routes/`** — Fastify route handlers: `auth.ts`, `projects.ts`, `containers.ts`, `import.ts`
- **`services/docker.ts`** — Wraps Docker CLI via `child_process.exec()` (no dockerode). All container and compose operations go through here
- **`services/watcher.ts`** — `FileWatcher` class using chokidar; watches compose file paths for projects with `watch_enabled=true` and auto-deploys on change (2s debounce)
- **`services/parser.ts`** — Parses `docker run` commands or existing standalone containers into compose file format (used by the import feature)
- **`websocket/index.ts`** — WebSocket at `/api/events`; broadcasts container heartbeats every 10s, handles `subscribe_logs`/`unsubscribe_logs` messages for live log streaming. The `fastify.broadcast()` decorator is used by routes to push events

### Frontend (`web/src/`)

- **`api/index.ts`** — Single API client with typed interfaces and `ApiError` class. Token stored in `localStorage` and sent as `Authorization: Bearer <token>`
- **`hooks/useAuth.tsx`** — `AuthProvider` context + `useAuth` hook; manages auth state and routing guards
- **`hooks/useWebSocket.ts`** — WebSocket connection management
- **`hooks/useProjects.ts`** — Project data fetching and mutation
- **`App.tsx`** — Router with three route guards: `ProtectedRoute`, `AuthRoute`, `InitialRoute`
- **`pages/Projects.tsx`** — Main page (all project/container management UI)
- **`pages/Auth.tsx`** — Setup, login, and change-password pages

### Data Flow

REST API for CRUD → WebSocket `/api/events` for real-time updates. The server broadcasts `{ type: 'heartbeat', containers }` every 10s so the frontend stays in sync without polling.

### Key Constraints

- **File paths**: Projects store host file paths (e.g. `/home/user/myapp/docker-compose.yml`). The app runs in Docker with the Docker socket mounted read-only at `/var/run/docker.sock`
- **Database**: `sql.js` requires calling `saveDb()` after every write — don't forget this when adding new mutations
- **ESM imports**: All local TypeScript imports must use `.js` extension (e.g. `import { db } from '../db/index.js'`)
- **Minimal deps**: Strongly resist adding new dependencies; Docker CLI is invoked via `exec()` intentionally

## Code Conventions

- **TypeScript**: Interfaces for object shapes, union types for literals, avoid `any`
- **File naming**: kebab-case for all files except React components (PascalCase)
- **CSS**: Plain CSS in `web/src/styles/`, CSS custom properties for theming, BEM-like class names, no Tailwind
- **Error handling (server)**: Return `{ success: false, output: string }` for expected errors; don't throw. Use `fastify.log.error()` for logging
- **Error handling (frontend)**: Catch `ApiError`, expose `error`/`loading` state from hooks

## Git Conventions

- Use gitmoji in commit messages (e.g. `✨ Add feature`, `🐛 Fix bug`)
- Feature branches for all changes
- Always ask for confirmation before pushing to `main`
