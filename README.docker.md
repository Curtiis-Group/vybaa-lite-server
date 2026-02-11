# Docker Setup for Vybaa Server

This document explains how to use Docker to run the Vybaa server application.

## Prerequisites

- Docker Desktop installed ([Download here](https://www.docker.com/products/docker-desktop))
- Docker Compose (included with Docker Desktop)
- Make (optional, for using Makefile commands)

## Quick Start

### Option 1: Using Makefile (Recommended)

```bash
# Complete installation in one command
make install

# Or step by step:
make setup      # Creates .env from template
# Edit .env with your credentials
make build      # Build Docker images
make up         # Start services
make migrate    # Run database migrations
```

### Option 2: Manual Setup

### 1. Environment Setup

Copy the environment template and fill in your configuration:

```bash
cp env.template .env
```

Edit `.env` and add your actual credentials for:
- JWT secrets (generate secure random strings)
- Google OAuth credentials
- Cloudinary credentials
- Firebase credentials
- Ably API key
- Gemini API key

### 2. Running in Production Mode

Start the server with PostgreSQL database:

```bash
docker-compose up -d
```

This will:
- Start a PostgreSQL database container
- Build and start the server in production mode
- Run Prisma migrations automatically
- Expose the server on port 4000 (or your configured PORT)

### 3. Running in Development Mode

For local development with hot-reload:

```bash
docker-compose --profile dev up server-dev
```

This will:
- Start the PostgreSQL database
- Run the server with `tsx watch` for automatic reloading
- Mount your source code as a volume for live updates

## Common Commands

### Using Makefile (Easier)

```bash
make help           # Show all available commands
make dev            # Start in development mode (hot-reload)
make up             # Start in production mode
make down           # Stop all services
make logs           # View all logs
make logs-server    # View server logs only
make logs-db        # View database logs only
make restart        # Restart all services
make rebuild        # Rebuild from scratch
make migrate        # Run database migrations
make db-push        # Push schema changes
make db-studio      # Open Prisma Studio
make shell          # Open shell in server container
make db-shell       # Open PostgreSQL shell
make status         # Show container status
make clean          # Stop and remove all data (⚠️ WARNING)
```

### Using Docker Compose Directly

#### View logs
```bash
# All services
docker-compose logs -f

# Server only
docker-compose logs -f server

# Database only
docker-compose logs -f postgres
```

#### Stop services
```bash
docker-compose down
```

#### Stop and remove volumes (deletes database data)
```bash
docker-compose down -v
```

#### Rebuild containers
```bash
docker-compose build --no-cache
docker-compose up -d
```

#### Run Prisma commands
```bash
# Generate Prisma client
docker-compose exec server npx prisma generate

# Run migrations
docker-compose exec server npx prisma migrate deploy

# Push schema changes (dev)
docker-compose exec server npx prisma db push

# Open Prisma Studio
docker-compose exec server npx prisma studio
```

#### Access database directly
```bash
docker-compose exec postgres psql -U vybaa -d vybaa_db
```

#### Execute commands in server container
```bash
docker-compose exec server sh
```

## Services

### PostgreSQL Database
- **Container Name:** `vybaa-postgres`
- **Port:** 5432 (mapped to host)
- **Volume:** `postgres_data` (persists database data)
- **Health Check:** Automatic with pg_isready

### Server (Production)
- **Container Name:** `vybaa-server`
- **Port:** 4000 (configurable via PORT env var)
- **Build Stage:** Production optimized
- **Auto-restart:** Yes

### Server Development
- **Container Name:** `vybaa-server-dev`
- **Port:** 4000 (configurable via PORT env var)
- **Hot Reload:** Yes (tsx watch)
- **Source Mounted:** Yes (live code updates)
- **Profile:** dev (only runs with `--profile dev`)

## Architecture

The Docker setup uses multi-stage builds:

1. **deps** - Installs all dependencies
2. **dev** - Development environment with hot-reload
3. **builder** - Compiles TypeScript and generates Prisma client
4. **production** - Optimized production image with only runtime dependencies

## Network

All services are connected via the `vybaa-network` bridge network, allowing them to communicate using service names as hostnames.

## Volumes

- `postgres_data` - Persists PostgreSQL database data
- `./logs` - Server logs (mounted to host for easy access)
- `./src` - Source code (dev mode only, enables hot-reload)

## Health Checks

Both PostgreSQL and the server have health checks configured:

- **PostgreSQL:** Uses `pg_isready` command
- **Server:** HTTP check on `/api` endpoint

## Security Features

- Non-root user in production container
- .dockerignore to exclude sensitive files
- Environment variables for secrets
- Alpine-based images for smaller attack surface

## Troubleshooting

### Server can't connect to database
- Ensure PostgreSQL is healthy: `docker-compose ps`
- Check DATABASE_URL uses `postgres` as hostname (service name)

### Port already in use
- Change PORT in `.env` file
- Check if another service is using port 4000

### Permission errors with logs
- Ensure logs directory has correct permissions
- May need to run: `chmod -R 777 logs`

### Migrations failing
- Run migrations manually: `docker-compose exec server npx prisma migrate deploy`
- Check PostgreSQL logs: `docker-compose logs postgres`

### Need to reset database
```bash
docker-compose down -v
docker-compose up -d
```

## Production Deployment

For production deployments:

1. Use strong, unique passwords in `.env`
2. Consider using Docker secrets or external secret management
3. Set up proper logging and monitoring
4. Use a managed PostgreSQL service (e.g., AWS RDS, Google Cloud SQL)
5. Configure proper backup strategies
6. Set resource limits in docker-compose.yml

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
