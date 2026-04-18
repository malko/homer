# HOMER: HOMelab container ManagER

A web-based container management system for homelab environments. Deploy, monitor, and update your Docker Compose projects through an intuitive interface.

> **Note**: This project was built to meet my own homelab needs. It may be useful for others wanting to set up a simple self-hosted environment, but it's not designed for production use. If you're looking for a more mature solution, consider projects like Dokploy, Coolify, or CasaOS.

## Features

- **Project Management**: Add Docker Compose projects via host file paths
- **One-Click Updates**: Pull latest images and redeploy with a single button
- **Auto-Update Policies**: Configure automatic updates with semver filtering (major/minor/patch)
- **Image Update Checking**: Automatic background checks via OCI registry APIs
- **Container Controls**: Start, stop, restart, and delete containers directly from the UI
- **System Monitoring**: Real-time CPU and memory usage with historical charts
- **System Resources**: Dedicated pages for Volumes, Networks, Images, and Containers
- **Reverse Proxy**: Built-in Caddy integration for automatic HTTPS and subdomain routing
- **Real-Time Updates**: WebSocket-powered live status updates
- **Watch Mode**: Auto-redeploy projects when compose files change
- **Terminal**: Embedded terminal access to containers from the browser
- **Log Viewer**: View container logs directly in the browser
- **Secure**: First-time setup with mandatory admin account creation

## Tech Stack

- **Backend**: Node.js + TypeScript + Fastify
- **Frontend**: React 19 + Vite
- **Database**: SQLite (better-sqlite3)
- **Communication**: REST API + WebSocket

## Quick Start

### Production (Recommended)

```bash
docker compose up -d
```

Uses the pre-built image from GHCR (`ghcr.io/malko/homer:latest`).

### Development (hot reload)

```bash
npm run docker:hotreload
```

Lance Caddy (port 8080), le serveur backend (`tsx watch`) et Vite (HMR) dans des containers Docker avec les sources montées en volume. Le premier démarrage est plus long (compilation des dépendances natives).

- UI : http://localhost:5174
- Caddy (proxy hosts) : http://localhost:8080 (configurable via `HOMER_DEV_PORT`)

### Standalone Deployment

If you just want to deploy Homer without cloning the repository:

```bash
curl -O https://raw.githubusercontent.com/malko/homer/main/docker-compose.yml
mkdir -p data
docker compose up -d
```

Access the UI at `http://<hostname>` (or `http://localhost` if on the same machine) and create your admin account.

By default, Caddy captures all HTTP traffic and routes it to Homer. To use a specific domain:
```bash
HOMER_DOMAIN=mondomaine.local docker compose up -d
```

> **Important**: If `HOMER_DOMAIN` is set, access the setup page via `http://<HOMER_DOMAIN>` or `http://localhost`. Accessing via another hostname may not work on port 80.

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

### Caddy Reverse Proxy

The included `docker-compose.yml` includes Caddy for automatic HTTPS. Configure domain suffix in settings.

## Project Structure

```
.
├── server/               # Fastify backend
│   └── src/
│       ├── db/           # SQLite setup and queries
│       ├── routes/      # API endpoints
│       ├── services/     # Docker CLI wrapper, registry checks
│       └── websocket/    # Real-time events
├── web/                 # React frontend
│   └── src/
│       ├── api/          # API client
│       ├── components/   # Reusable UI components
│       ├── hooks/        # Custom React hooks
│       ├── pages/        # Page components
│       └── styles/       # CSS files
├── Dockerfile            # Multi-stage build
└── docker-compose.yml    # Deployment configuration
```

## Pages

| Page | Description |
|------|-------------|
| **Home** | Dashboard with service tiles and quick actions |
| **Projects** | Manage Docker Compose projects |
| **Monitor** | System CPU/memory usage with historical charts |
| **Containers** | All Docker containers with status and update info |
| **Volumes** | Docker volumes including compose-declared volumes |
| **Networks** | Docker networks with usage information |
| **Images** | Docker images with usage status and cleanup options |
| **Proxy** | Caddy reverse proxy configuration |
| **Settings** | System configuration, auto-update settings |

## API Endpoints

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/setup` | Create admin account |
| POST | `/api/auth/login` | Authenticate |
| POST | `/api/auth/logout` | Logout |

### Projects
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List managed projects |
| POST | `/api/projects` | Add a project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| POST | `/api/projects/:id/deploy` | Deploy project |
| POST | `/api/projects/:id/update` | Update images |

### Containers
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/containers` | List all containers |
| POST | `/api/containers/:id/start` | Start container |
| POST | `/api/containers/:id/stop` | Stop container |
| POST | `/api/containers/:id/restart` | Restart container |
| DELETE | `/api/containers/:id` | Remove container |
| POST | `/api/containers/:id/update-image` | Update container image |

### System Resources
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system/containers` | Homer system containers |
| GET | `/api/system/all-containers` | All Docker containers |
| GET | `/api/system/volumes` | Docker volumes |
| GET | `/api/system/networks` | Docker networks |
| GET | `/api/system/images` | Docker images |
| POST | `/api/system/images/prune` | Prune unused images |
| DELETE | `/api/system/images/:id` | Remove image |
| DELETE | `/api/system/networks/:name` | Remove network |
| POST | `/api/system/networks/prune` | Prune unused networks |

### Proxy
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/proxy/hosts` | List proxy hosts |
| POST | `/api/proxy/hosts` | Create proxy host |
| PUT | `/api/proxy/hosts/:id` | Update proxy host |
| DELETE | `/api/proxy/hosts/:id` | Delete proxy host |
| GET | `/api/proxy/config` | Get Caddy config |
| PUT | `/api/proxy/config` | Push Caddy config |

### Monitoring
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system/stats` | System CPU/memory stats |
| GET | `/api/system/updates` | Project update status |

| WS | `/api/events` | Real-time updates |

## Security

- Admin account created on first access (no default password)
- JWT-based session authentication
- Password hashing with bcrypt

## Auto-Update Configuration

Configure automatic image updates in project settings:

| Policy | Description |
|--------|-------------|
| `disabled` | No automatic updates |
| `all` | Update to latest version |
| `semver_minor` | Only minor updates (e.g., 1.0 → 1.1) |
| `semver_patch` | Only patch updates (e.g., 1.0.0 → 1.0.1) |

## Dependencies

Minimal dependencies to reduce security surface:

- **Backend**: fastify, better-sqlite3, bcryptjs, ws
- **Frontend**: react, react-dom, react-router-dom

No ESLint/Prettier — relies on TypeScript compiler for type checking.

## Testing

```bash
# Run server tests
cd server && npm test
```

## Publishing a New Release

New versions are automatically published to GHCR when a tag is pushed to main:

```bash
npm run release patch   # 1.0.0 → 1.0.1
npm run release minor  # 1.0.0 → 1.1.0
npm run release major  # 1.0.0 → 2.0.0

git push && git push --tags
```

## Git Configuration

If you encounter SSH authentication errors when pushing:

```bash
# Use HTTPS instead of SSH
git remote set-url origin https://github.com/malko/homer.git

# Or configure SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"
# Add the public key to GitHub → Settings → SSH and GPG keys
```