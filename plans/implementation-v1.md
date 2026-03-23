# Homelab Container Manager - Implementation Plan

## Tech Stack
- **Backend**: Node.js + TypeScript + Fastify
- **Frontend**: React 19.2 + Vite
- **Database**: SQLite (better-sqlite3)
- **Real-time**: Native WebSocket (@fastify/websocket)
- **File watching**: chokidar
- **Styling**: Plain CSS

## Dependencies

### Backend (8 total)
- fastify
- @fastify/cors
- @fastify/websocket
- better-sqlite3
- bcryptjs
- zod
- chokidar
- dotenv

### Frontend (3 total)
- react@19.2
- react-dom@19.2
- react-router-dom

## Project Structure
```
homelab-container-manager/
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── db/
│   │   ├── routes/
│   │   ├── services/
│   │   └── websocket/
│   └── package.json
├── web/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── styles/
│   └── package.json
├── Dockerfile (multi-stage build)
├── docker-compose.yml
└── package.json (workspace root)
```

## Database Schema

```sql
-- users: id, username, password_hash, must_change_password, created_at
-- projects: id, name, path, env_path, auto_update, watch_enabled, created_at
-- settings: key, value (global config)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate |
| POST | `/api/auth/change-password` | Force change password |
| GET | `/api/auth/status` | Check if password change required |
| GET | `/api/projects` | List managed projects |
| POST | `/api/projects` | Add project (path + optional import) |
| DELETE | `/api/projects/:id` | Remove from management |
| POST | `/api/projects/:id/deploy` | Deploy/Update |
| POST | `/api/projects/:id/update` | One-click image update |
| GET | `/api/containers` | List all containers |
| POST | `/api/containers/:id/start\|stop\|restart` | Container actions |
| GET | `/api/containers/:id/logs` | Stream logs |
| WS | `/api/events` | Real-time container status |

## Key Flows

### First Connection Setup
1. User visits app → detect no admin exists
2. Show account creation form (username + password)
3. Create admin user in SQLite
4. Redirect to main dashboard

### Add Compose Project
1. User provides path to compose file on host (e.g., `/opt/app/postgres`)
2. App validates path exists and contains valid compose file
3. Optionally import currently running containers from that project
4. Store project in SQLite
5. Enable watch mode + auto-update if desired

### One-Click Update Flow
```
1. docker compose -p <name> pull
2. Compare image IDs (docker images --no-trunc)
3. If changed → docker compose up -d --pull always
4. docker image prune -f
5. Push diff via WebSocket
```

### Docker Socket Access
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

## Phases

### Phase 1: Backend Foundation
- Initialize server project with Fastify + TypeScript
- Set up SQLite database schema
- Docker client integration (list, start, stop, restart, logs, pull)
- Compose file detection & parsing
- Auto-deployment logic

### Phase 2: Core API Endpoints
- Auth endpoints (login, change-password, status)
- Project CRUD endpoints
- Container management endpoints
- WebSocket for real-time events

### Phase 3: Frontend Foundation
- Vite + React 19.2 + TypeScript setup
- React Router for navigation
- Basic layout (sidebar + main content)
- Plain CSS styling

### Phase 4: Core UI
- Login / First-time setup page
- Project list page (add/remove compose directories)
- Container dashboard (status, quick actions)
- One-click update button per container/project
- Container logs viewer

### Phase 5: Watch Mode
- File watching with chokidar
- Auto-redeploy on compose file modification

### Phase 6: Containerization
- Dockerfile for multi-stage build
- docker-compose.yml with proper socket mounting
- Traefik-ready labels
