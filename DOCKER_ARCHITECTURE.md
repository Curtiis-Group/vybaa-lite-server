# 🏗️ Docker Architecture Overview

Visual guide to understanding the Vybaa server Docker setup.

## 📦 Container Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Docker Compose                              │
│                   (docker-compose.yml)                           │
│                                                                   │
│  ┌────────────────────────┐      ┌─────────────────────────┐   │
│  │   vybaa-server         │      │   vybaa-postgres        │   │
│  │   (Node.js 20)         │◄────►│   (PostgreSQL 16)       │   │
│  │                        │      │                         │   │
│  │  • Express API         │      │  • Database: vybaa_db   │   │
│  │  • TypeScript          │      │  • User: vybaa          │   │
│  │  • Prisma ORM          │      │  • Port: 5432           │   │
│  │  • Port: 4000          │      │  • Volume: postgres_data│   │
│  │  • Health checks       │      │  • Health checks        │   │
│  │  • Auto-restart        │      │  • Auto-restart         │   │
│  └────────────────────────┘      └─────────────────────────┘   │
│           │                                    │                 │
│           └──────────┬─────────────────────────┘                │
│                      │                                           │
│              ┌───────▼────────┐                                 │
│              │ vybaa-network  │                                 │
│              │ (Bridge)       │                                 │
│              └────────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘
                       │
                       │ Port Mapping
                       ▼
              ┌────────────────┐
              │   Host Machine │
              │                │
              │  localhost:4000 → Server API
              │  localhost:5432 → PostgreSQL
              └────────────────┘
```

## 🔄 Multi-Stage Build Process

The Dockerfile uses a multi-stage build for optimization:

```
┌─────────────────────────────────────────────────────────────┐
│                    Dockerfile Stages                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Stage 1: BASE                                              │
│  ┌────────────────────────────────────────────┐            │
│  │  node:20-alpine                            │            │
│  │  • Minimal Alpine Linux                    │            │
│  │  • Node.js 20                              │            │
│  └────────────────────────────────────────────┘            │
│                      │                                       │
│                      ▼                                       │
│  Stage 2: DEPS                                              │
│  ┌────────────────────────────────────────────┐            │
│  │  Install Dependencies                      │            │
│  │  • pnpm install                            │            │
│  │  • All dependencies (dev + prod)           │            │
│  └────────────────────────────────────────────┘            │
│                      │                                       │
│         ┌────────────┴────────────┐                        │
│         ▼                          ▼                        │
│  Stage 3a: DEV          Stage 3b: BUILDER                  │
│  ┌──────────────┐      ┌──────────────────┐               │
│  │ Development  │      │ Build TypeScript │               │
│  │ • tsx watch  │      │ • tsc compile    │               │
│  │ • Hot reload │      │ • Generate dist/ │               │
│  │ • All deps   │      │ • Prisma client  │               │
│  └──────────────┘      └──────────────────┘               │
│                                 │                           │
│                                 ▼                           │
│                      Stage 4: PRODUCTION                    │
│                      ┌──────────────────────┐              │
│                      │ Optimized Runtime    │              │
│                      │ • Prod deps only     │              │
│                      │ • Compiled JS        │              │
│                      │ • Non-root user      │              │
│                      │ • Health checks      │              │
│                      │ • ~150MB image       │              │
│                      └──────────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Startup Sequence

```
┌─────────────────────────────────────────────────────────────┐
│                    Startup Flow                              │
└─────────────────────────────────────────────────────────────┘

1. docker-compose up
   │
   ├─► Start postgres container
   │   │
   │   ├─► Initialize database
   │   ├─► Run init-db.sql
   │   ├─► Health check: pg_isready
   │   └─► ✓ Ready
   │
   └─► Wait for postgres health check
       │
       └─► Start server container
           │
           ├─► Load environment variables (.env)
           ├─► Run: npx prisma migrate deploy
           ├─► Start: node dist/server.js
           ├─► Health check: GET /api/health
           └─► ✓ Server running on port 4000

```

## 📂 Volume Mapping

```
┌─────────────────────────────────────────────────────────────┐
│                    Volume Architecture                       │
└─────────────────────────────────────────────────────────────┘

Host Machine                    Container
────────────                    ─────────

Production Mode:
./logs/                    ──► /app/logs/
                               (Persistent logs)

postgres_data (Docker)     ──► /var/lib/postgresql/data
                               (Database persistence)

Development Mode (Additional):
./src/                     ──► /app/src/
                               (Live code updates)
./prisma/                  ──► /app/prisma/
                               (Schema changes)
```

## 🌐 Network Communication

```
┌─────────────────────────────────────────────────────────────┐
│                Network Communication Flow                    │
└─────────────────────────────────────────────────────────────┘

External Request
      │
      ▼
┌──────────────┐
│ Host Machine │
│ Port 4000    │
└──────────────┘
      │
      │ Port Mapping
      ▼
┌──────────────────────┐
│ vybaa-server         │
│ Container Port 4000  │
│                      │
│ Express API          │
└──────────────────────┘
      │
      │ Internal Network
      │ (vybaa-network)
      │
      │ Service Name: postgres
      │ Port: 5432
      ▼
┌──────────────────────┐
│ vybaa-postgres       │
│ Container Port 5432  │
│                      │
│ PostgreSQL Database  │
└──────────────────────┘
      │
      │ Volume Mount
      ▼
┌──────────────────────┐
│ postgres_data        │
│ Docker Volume        │
└──────────────────────┘
```

## 🔐 Environment Variable Flow

```
┌─────────────────────────────────────────────────────────────┐
│              Environment Variable Injection                  │
└─────────────────────────────────────────────────────────────┘

.env file (Host)
      │
      │ Read by docker-compose
      ▼
docker-compose.yml
      │
      │ Pass to container
      ▼
Container Environment
      │
      │ Load in Node.js
      ▼
src/utils/env.util.ts
      │
      │ Use in application
      ▼
Application Code

Example:
.env: DATABASE_URL=postgresql://...
  ↓
docker-compose.yml: environment: DATABASE_URL=${DATABASE_URL}
  ↓
Container: process.env.DATABASE_URL
  ↓
Prisma Client: Uses DATABASE_URL
```

## 🛠️ Development vs Production

```
┌─────────────────────────────────────────────────────────────┐
│            Development vs Production Comparison              │
└─────────────────────────────────────────────────────────────┘

Development Mode (make dev)
┌──────────────────────────────┐
│ • Target: dev                │
│ • Command: tsx watch         │
│ • Source: Mounted volumes    │
│ • Hot Reload: ✓ Yes          │
│ • Size: ~400MB               │
│ • Build Time: Fast           │
│ • Dependencies: All          │
│ • Use Case: Local dev        │
└──────────────────────────────┘

Production Mode (make up)
┌──────────────────────────────┐
│ • Target: production         │
│ • Command: node dist/        │
│ • Source: Compiled in image  │
│ • Hot Reload: ✗ No           │
│ • Size: ~150MB               │
│ • Build Time: Slower         │
│ • Dependencies: Prod only    │
│ • Use Case: Deployment       │
└──────────────────────────────┘
```

## 📊 Data Persistence

```
┌─────────────────────────────────────────────────────────────┐
│                  Data Persistence Strategy                   │
└─────────────────────────────────────────────────────────────┘

Persistent (Survives container restart):
┌────────────────────────────────────┐
│ postgres_data (Docker Volume)      │
│ • Database files                   │
│ • Survives: docker-compose down    │
│ • Lost: docker-compose down -v     │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ ./logs/ (Bind Mount)               │
│ • Application logs                 │
│ • Always persists on host          │
└────────────────────────────────────┘

Ephemeral (Lost on container removal):
┌────────────────────────────────────┐
│ Container filesystem               │
│ • Compiled code                    │
│ • node_modules                     │
│ • Temporary files                  │
└────────────────────────────────────┘
```

## 🔄 Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│              Complete Request Flow                           │
└─────────────────────────────────────────────────────────────┘

Client (Mobile App)
      │
      │ HTTPS
      ▼
Reverse Proxy (Nginx/Production)
      │
      │ HTTP
      ▼
Docker Host Port 4000
      │
      │ Port Mapping
      ▼
vybaa-server Container
      │
      ├─► Request Logger Middleware
      │
      ├─► CORS Middleware
      │
      ├─► Body Parser
      │
      ├─► Routes (/api/v1/...)
      │   │
      │   ├─► Auth Middleware (if protected)
      │   │
      │   ├─► Validation Middleware
      │   │
      │   └─► Controller
      │       │
      │       └─► Service
      │           │
      │           └─► Prisma Client
      │               │
      │               │ Internal Network
      │               ▼
      │           vybaa-postgres
      │               │
      │               └─► postgres_data volume
      │
      └─► Response
          │
          ▼
      Client receives JSON
```

## 🎯 Health Check System

```
┌─────────────────────────────────────────────────────────────┐
│                  Health Check Flow                           │
└─────────────────────────────────────────────────────────────┘

Docker Health Check (Every 30s)
      │
      ├─► PostgreSQL
      │   │
      │   └─► Command: pg_isready -U vybaa
      │       │
      │       ├─► Success: Container healthy
      │       └─► Fail (3x): Container unhealthy
      │
      └─► Server
          │
          └─► HTTP GET: http://localhost:4000/api/health
              │
              ├─► Success (200): Container healthy
              └─► Fail (3x): Container unhealthy → Restart

Health Endpoint Response:
{
  "status": "ok",
  "timestamp": "2026-02-11T...",
  "uptime": 3600
}
```

## 🚦 Makefile Command Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  Makefile Commands                           │
└─────────────────────────────────────────────────────────────┘

make install
  ├─► make setup (copy env.template → .env)
  ├─► make build (docker-compose build)
  ├─► make up (docker-compose up -d)
  └─► make migrate (prisma migrate deploy)

make dev
  └─► docker-compose --profile dev up server-dev
      └─► Starts with hot-reload

make logs
  └─► docker-compose logs -f
      └─► Stream all logs

make db-shell
  └─► docker-compose exec postgres psql -U vybaa -d vybaa_db
      └─► Interactive database shell

make clean
  └─► docker-compose down -v
      └─► ⚠️ Removes all data!
```

## 📈 Scaling Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Future Scaling Options                          │
└─────────────────────────────────────────────────────────────┘

Current (Single Server):
┌──────────┐     ┌──────────┐
│  Server  │────►│ Database │
└──────────┘     └──────────┘

Scaled (Multiple Servers):
┌──────────┐
│  Load    │
│ Balancer │
└──────────┘
      │
      ├─────┬─────┬─────┐
      ▼     ▼     ▼     ▼
   ┌────┐┌────┐┌────┐┌────┐
   │ S1 ││ S2 ││ S3 ││ S4 │
   └────┘└────┘└────┘└────┘
      │     │     │     │
      └─────┴─────┴─────┘
            ▼
      ┌──────────┐
      │ Database │
      │ (Managed)│
      └──────────┘

Implementation:
• docker-compose scale server=4
• Add load balancer (Nginx/HAProxy)
• Use managed database (RDS/Cloud SQL)
• Add Redis for session storage
```

## 🔍 Debugging Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Debugging Tools                             │
└─────────────────────────────────────────────────────────────┘

View Logs:
  make logs              → All logs
  make logs-server       → Server logs only
  make logs-db          → Database logs only

Access Containers:
  make shell            → Server shell
  make db-shell         → PostgreSQL shell

Inspect State:
  docker-compose ps     → Container status
  docker stats          → Resource usage
  docker inspect        → Detailed info

Database Tools:
  make db-studio        → Prisma Studio GUI
  make db-shell         → psql CLI

Network Debugging:
  docker network ls
  docker network inspect vybaa_vybaa-network
```

---

## 📚 Key Takeaways

1. **Two Containers**: Server (Node.js) + Database (PostgreSQL)
2. **Bridge Network**: Containers communicate via service names
3. **Multi-Stage Build**: Optimized for dev and production
4. **Volume Persistence**: Database and logs persist
5. **Health Checks**: Automatic monitoring and restart
6. **Environment Variables**: Injected from .env file
7. **Port Mapping**: 4000 (server), 5432 (database)
8. **Makefile**: Simplified command interface

---

**Visual learner?** This architecture ensures:
- ✅ Isolation (containers)
- ✅ Portability (runs anywhere)
- ✅ Consistency (same env everywhere)
- ✅ Scalability (easy to scale)
- ✅ Maintainability (clear structure)

