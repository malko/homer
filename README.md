# HOMER: HOMelab container ManagER

A web-based container management system for homelab environments. Deploy, monitor, and update your Docker Compose projects through an intuitive interface.

## Features

- **Project Management**: Add Docker Compose projects via host file paths
- **One-Click Updates**: Pull latest images and redeploy with a single button
- **Container Controls**: Start, stop, and restart containers directly from the UI
- **Real-Time Status**: WebSocket-powered live container status updates
- **Watch Mode**: Auto-redeploy projects when compose files change
- **Log Viewer**: View container logs directly in the browser
- **Secure**: First-time setup with mandatory admin account creation

## Tech Stack

- **Backend**: Node.js + TypeScript + Fastify
- **Frontend**: React 19.2 + Vite
- **Database**: SQLite (better-sqlite3)
- **Communication**: REST API + WebSocket

## Quick Start

### Docker (Recommended)

```bash
docker compose up -d
```

Access at http://localhost:4000 (or configure your reverse proxy).

### Development

```bash
# Install dependencies
npm install

# Run both server and frontend
npm run dev
```

- Frontend: http://localhost:5174
- Backend API: http://localhost:4000

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4000 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `NODE_ENV` | production | Environment mode |

### Docker Socket

The app requires access to the host's Docker socket to manage containers:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

### Traefik Integration

The included `docker-compose.yml` includes Traefik labels for automatic discovery. Remove or modify them if you use a different reverse proxy.

## Project Structure

```
.
├── server/           # Fastify backend
│   └── src/
│       ├── db/           # SQLite setup
│       ├── routes/       # API endpoints
│       ├── services/     # Docker CLI wrapper
│       └── websocket/    # Real-time events
├── web/              # React frontend
│   └── src/
│       ├── api/          # API client
│       ├── hooks/         # React hooks
│       └── pages/        # Page components
├── Dockerfile        # Multi-stage build
└── docker-compose.yml
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/setup` | Create admin account |
| POST | `/api/auth/login` | Authenticate |
| GET | `/api/projects` | List managed projects |
| POST | `/api/projects` | Add a project |
| POST | `/api/projects/:id/deploy` | Deploy project |
| POST | `/api/projects/:id/update` | Update images |
| GET | `/api/containers` | List all containers |
| POST | `/api/containers/:id/start\|stop\|restart` | Container actions |
| WS | `/api/events` | Real-time updates |

## Security

- Admin account created on first access (no default password)
- JWT-based session authentication
- Password hashing with bcrypt

## Dependencies

Minimal dependencies to reduce security surface:

- **Backend**: 8 runtime deps (fastify, better-sqlite3, bcryptjs, etc.)
- **Frontend**: 3 runtime deps (react, react-dom, react-router-dom)

No ESLint/Prettier tooling — relies on TypeScript compiler for type checking.
