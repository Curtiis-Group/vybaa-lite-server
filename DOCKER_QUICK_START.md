# 🚀 Docker Quick Start Guide

Get the Vybaa server running with Docker in 5 minutes!

## Prerequisites

Install Docker Desktop:

- **Mac**: [Download Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)
- **Windows**: [Download Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
- **Linux**: Follow [official installation guide](https://docs.docker.com/engine/install/)

## 🎯 Quick Start (3 Steps)

### Step 1: Setup Environment

```bash
# Navigate to server directory
cd server

# Create .env file from template
cp env.template .env

# Generate secure JWT secrets
node scripts/generate-secrets.js

# Edit .env and add the generated secrets + your API credentials
nano .env  # or use your favorite editor
```

### Step 2: Start Everything

```bash
# Option A: Using Makefile (Recommended)
make install

# Option B: Using Docker Compose
docker-compose up -d
docker-compose exec server npx prisma migrate deploy
```

### Step 3: Verify It's Running

```bash
# Check status
curl http://localhost:4000/api/health

# Or visit in browser
open http://localhost:4000/api
```

That's it! Your server is running! 🎉

---

## 🛠️ Daily Usage

### Start the server

```bash
make up        # or: docker-compose up -d
```

### Stop the server

```bash
make down      # or: docker-compose down
```

### View logs

```bash
make logs      # or: docker-compose logs -f
```

### Development mode (hot-reload)

```bash
make dev       # or: docker-compose --profile dev up server-dev
```

---

## 📝 Common Tasks

### Run Database Migrations

```bash
make migrate
# or: docker-compose exec server npx prisma migrate deploy
```

### Access Database

```bash
make db-shell
# or: docker-compose exec postgres psql -U vybaa -d vybaa_db
```

### View Prisma Studio

```bash
make db-studio
# or: docker-compose exec server npx prisma studio
```

### Access Server Shell

```bash
make shell
# or: docker-compose exec server sh
```

### Restart Server

```bash
make restart
# or: docker-compose restart server
```

### Rebuild Everything

```bash
make rebuild
# or: docker-compose build --no-cache && docker-compose up -d
```

---

## 🔧 Troubleshooting

### ❌ "Port 4000 already in use"

**Solution 1:** Stop the conflicting service

```bash
lsof -ti:4000 | xargs kill -9
```

**Solution 2:** Change the port in `.env`

```bash
PORT=4001
```

### ❌ "Cannot connect to database"

**Check database is running:**

```bash
docker-compose ps
```

**Restart database:**

```bash
docker-compose restart postgres
```

### ❌ "Prisma Client not generated"

**Regenerate Prisma Client:**

```bash
docker-compose exec server npx prisma generate
```

### ❌ Changes not reflecting

**For code changes:** Use development mode

```bash
make dev
```

**For dependency changes:** Rebuild

```bash
make rebuild
```

### ❌ Database connection errors

**Check DATABASE_URL format:**

```
DATABASE_URL=postgresql://vybaa:vybaa_password@postgres:5432/vybaa_db?schema=public
```

Note: Use `postgres` (service name) as hostname, not `localhost`

### ❌ Fresh start needed

**Reset everything (⚠️ deletes all data):**

```bash
make clean
make install
```

---

## 📚 Environment Variables

Required variables in `.env`:

```bash
# Database (auto-configured for Docker)
DATABASE_URL=postgresql://vybaa:vybaa_password@postgres:5432/vybaa_db

# JWT Secrets (generate with: node scripts/generate-secrets.js)
JWT_SECRET=your_generated_secret
JWT_REFRESH_SECRET=your_generated_secret

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Firebase
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY=your_private_key
FIREBASE_CLIENT_EMAIL=your_client_email

# First-party realtime WebSocket fan-out
REDIS_URL=redis://redis:6379
REALTIME_MAX_CONNECTIONS_PER_USER=4
REWIND_ASYNC_CHAT_ENABLED=true
REWIND_AUTONOMOUS_CHAT_ENABLED=true

# Google Gemini AI
GEMINI_API_KEY=your_gemini_key
```

---

## 🎓 Understanding the Setup

### What Docker Compose Creates

1. **PostgreSQL Database** (`vybaa-postgres`)
   - Port: 5432
   - User: vybaa
   - Database: vybaa_db
   - Data persisted in Docker volume

2. **Redis Realtime Broker** (`vybaa-redis`)
   - Delivers WebSocket events across server instances
   - Available only inside the Docker network

3. **API Server** (`vybaa-server`)
   - Port: 4000
   - Auto-restarts on crash
   - Logs saved to `./logs`

4. **Network** (`vybaa-network`)
   - Connects database and server
   - Services talk via service names

### Development vs Production

**Production Mode** (`make up`)

- Optimized build
- TypeScript compiled
- Production dependencies only
- Runs: `node dist/server.js`

**Development Mode** (`make dev`)

- Source code mounted as volume
- Hot-reload on changes
- All dependencies
- Runs: `tsx watch src/server.ts`

---

## 🔐 Security Notes

1. **Never commit `.env` file** - It's gitignored automatically
2. **Change default passwords** - Don't use example passwords in production
3. **Generate strong JWT secrets** - Use the provided script
4. **Use environment-specific configs** - Different `.env` for dev/staging/prod

---

## 📖 Additional Resources

- [Full Docker Documentation](./README.docker.md)
- [Makefile Commands](./Makefile) - Run `make help`
- [Docker Compose Docs](https://docs.docker.com/compose/)
- [Prisma Docs](https://www.prisma.io/docs/)

---

## 🆘 Need Help?

1. Check logs: `make logs`
2. Check container status: `docker-compose ps`
3. Try fresh start: `make clean && make install`
4. Read detailed docs: [README.docker.md](./README.docker.md)

---

**Happy coding! 🚀**
