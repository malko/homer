# Agent Guidelines

This document provides guidelines for agents working on the Homelab Container Manager codebase.

## Project Structure

```
.
├── server/               # Fastify backend (Node.js/TypeScript)
│   └── src/
│       ├── db/           # SQLite database setup and queries
│       ├── routes/       # API route handlers
│       ├── services/     # Business logic (Docker, file watching)
│       └── websocket/    # WebSocket setup
├── web/                  # React 19.2 frontend (Vite)
│   └── src/
│       ├── api/          # API client
│       ├── components/   # Reusable UI components
│       ├── hooks/        # Custom React hooks
│       ├── pages/        # Page components
│       └── styles/       # CSS files
├── Dockerfile            # Multi-stage build
└── docker-compose.yml    # Deployment configuration
```

## Build Commands

### Development
```bash
# Run both server and frontend in watch mode
npm run dev

# Run only server (http://localhost:4000)
npm run dev:server

# Run only frontend (http://localhost:5174)
npm run dev:web
```

### Production
This machine is not intended to run the service directly
```bash
# Build both server and frontend
npm run build

# Start production server -> NEVER EXECUTE THIS ON THIS MACHINE
npm start 

# Build and run in Docker -> NEVER EXECUTE THIS ON THIS MACHINE
docker compose up --build -d
```

### Server Commands
```bash
cd server
npm run dev      # Development with tsx watch
npm run build    # TypeScript compile to dist/
npm start        # Run compiled server
```

### Frontend Commands
```bash
cd web
npm run dev      # Vite dev server
npm run build    # Production build to dist/
npm run preview  # Preview production build
```

## Code Style Guidelines

### TypeScript

- **Strict typing**: Always use explicit types; avoid `any`
- **Interfaces over types** for object shapes:
  ```typescript
  interface User {
    id: number;
    name: string;
    email?: string;
  }
  ```
- **Union types** for literal values:
  ```typescript
  type ContainerState = 'running' | 'exited' | 'paused';
  ```
- **Import extensions**: Use `.js` extension for local imports (ESM requirement):
  ```typescript
  import { db } from '../db/index.js';
  ```

### React (Frontend)

- **Functional components only** with hooks
- **Component files**: `.tsx` extension when containing JSX, `.ts` otherwise
- **Hooks location**: All custom hooks in `src/hooks/`
- **API calls**: Centralized in `src/api/index.ts`
- **No named exports for React components** (except when needed)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `use-auth.tsx`, `docker-service.ts` |
| Components | PascalCase | `ProjectCard.tsx`, `ContainerItem.tsx` |
| Hooks | camelCase, `use` prefix | `useProjects.ts`, `useAuth.tsx` |
| Functions | camelCase | `listContainers`, `deployProject` |
| Interfaces | PascalCase | `Container`, `Project` |
| Database tables | snake_case | `users`, `projects` |
| Database columns | snake_case | `env_path`, `auto_update` |
| CSS classes | kebab-case | `container-item`, `status-badge` |

### Imports Order

```typescript
// 1. Node.js built-ins
import { exec, spawn } from 'child_process';
import fs from 'fs/promises';

// 2. External packages
import Fastify from 'fastify';
import bcrypt from 'bcryptjs';

// 3. Internal modules (with .js extension for ESM)
import { db } from '../db/index.js';
import { listContainers } from './docker.js';

// 4. Types/interfaces
import type { Container } from './types.js';
```

### Error Handling

**Backend (server/)**:
- Use `try/catch` blocks with typed errors:
  ```typescript
  try {
    await someOperation();
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string };
    return { success: false, output: err.stderr || err.message || 'Unknown error' };
  }
  ```
- Return result objects instead of throwing for expected errors
- Use `fastify.log.error()` for logging server errors

**Frontend (web/)**:
- Use custom error classes:
  ```typescript
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  ```
- Handle errors in hooks with state (`error`, `loading`)
- Display errors to users via UI components

### Database Patterns

- Use `better-sqlite3` prepared statements for queries
- Export query functions from `db/index.ts`:
  ```typescript
  export const userQueries = {
    getById: db.prepare<[number], User>('SELECT * FROM users WHERE id = ?'),
    create: db.prepare<[string, string]>('INSERT INTO users (...) VALUES (...)'),
  };
  ```
- Always use parameterized queries (no string concatenation)

### API Design

- RESTful endpoint naming: `/api/resources` (plural)
- Use Fastify request/response schemas where beneficial
- Return appropriate HTTP status codes:
  - `200` for success
  - `400` for bad request
  - `401` for unauthorized
  - `404` for not found
  - `500` for server errors

### CSS Guidelines

- Plain CSS in `src/styles/` (no Tailwind, no CSS-in-JS)
- CSS custom properties for theming:
  ```css
  :root {
    --color-primary: #3b82f6;
    --color-bg: #0f172a;
  }
  ```
- Component-specific classes with clear naming
- BEM-like naming: `container-item`, `container-info`, `container-actions`

## Dependencies Philosophy

This project prioritizes **minimal dependencies** to reduce security surface:

- **Backend**: 8 runtime dependencies (fastify, better-sqlite3, bcryptjs, etc.)
- **Frontend**: 3 runtime dependencies (react, react-dom, react-router-dom)
- **No**: ESLint/Prettier tooling (relies on TypeScript compiler for checks)
- **Docker**: CLI invoked via `exec()` (no dockerode package)

Before adding a dependency, verify it is truly necessary.

## Docker Considerations

- App runs in a container but manages host Docker via mounted socket
- All file paths for compose projects reference host paths
- SQLite database stored in `./data/` volume mount
- Socket mount: `/var/run/docker.sock:/var/run/docker.sock:ro`

## Testing Guidelines

Unit tests are **required** for all new features to ensure code reliability and prevent regressions.

### Test Structure

- Place test files in a `__tests__/` directory alongside the code being tested
- Test files should use the naming convention `*.test.ts` or `*.test.tsx`
- Run tests with `npm test` (server) or the appropriate test command for the frontend

### Writing Tests

- Test business logic and utility functions with unit tests
- Test API routes using integration tests when feasible
- Aim for meaningful coverage of critical paths
- Tests should be independent and not depend on execution order

## Git conventions
- Use feature branches for new features or bug fixes
- Use descriptive commit messages using gitmoji (e.g., "✨ Add user authentication API")
- Make atomic commits (one logical change per commit)
- Always ask the user for confirmation before pushing to the main branch