# Vybaa Server

Backend API server for the Vybaa productivity and wellness application.

## 🚀 Quick Start with Docker

**New to Docker?** Start here: [DOCKER_QUICK_START.md](./DOCKER_QUICK_START.md)

```bash
# 1. Setup environment
make setup
# Edit .env with your credentials

# 2. Start server + database
make up

# 3. Run migrations
make migrate

# Done! Server running on http://localhost:4000
```

## 📚 Documentation

- **[DOCKER_QUICK_START.md](./DOCKER_QUICK_START.md)** - Get started in 5 minutes
- **[README.docker.md](./README.docker.md)** - Comprehensive Docker guide
- **[DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)** - Production deployment
- **[DOCKER_SETUP_SUMMARY.md](./DOCKER_SETUP_SUMMARY.md)** - What's included

## 🛠️ Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express 5
- **Language**: TypeScript
- **Database**: PostgreSQL 16
- **ORM**: Prisma
- **Real-time**: First-party WebSockets with Redis fan-out
- **AI**: Google Gemini
- **Storage**: Cloudinary
- **Push Notifications**: Firebase Cloud Messaging
- **Authentication**: JWT + Google OAuth

## 📁 Project Structure

```
server/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Request handlers
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── utils/           # Utility functions
│   ├── validators/      # Input validation
│   └── server.ts        # Entry point
├── prisma/
│   └── schema.prisma    # Database schema
├── scripts/
│   └── generate-secrets.js
├── Dockerfile           # Docker image definition
├── docker-compose.yml   # Service orchestration
├── Makefile            # Command shortcuts
└── env.template        # Environment variables template
```

## 🔧 Development

### Prerequisites

- Docker Desktop (recommended) OR
- Node.js 20+ and PostgreSQL 16+

### With Docker (Recommended)

```bash
# Development mode with hot-reload
make dev

# View logs
make logs

# Access database
make db-shell

# Open Prisma Studio
make db-studio
```

### Without Docker

```bash
# Install dependencies
pnpm install

# Setup database
createdb vybaa_db

# Configure .env
cp env.template .env
# Edit .env with your DATABASE_URL and credentials

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Start development server
npm run dev
```

## 📝 Available Scripts

```bash
# Development
npm run dev              # Start with hot-reload
npm run build            # Build TypeScript
npm run start            # Start production build

# Database
npm run db:sync          # Generate client + push schema
npm run db:migrate       # Deploy migrations
npm run db:migrate:dev   # Create + run migration
npm run db:studio        # Open Prisma Studio

# Utilities
npm run generate-secrets # Generate JWT secrets

# Docker
npm run docker:build     # Build Docker images
npm run docker:up        # Start services
npm run docker:down      # Stop services
npm run docker:logs      # View logs
npm run docker:dev       # Start dev mode
```

## 🔐 Environment Variables

Required variables (see `env.template`):

```bash
# Server
PORT=4000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/vybaa_db

# JWT (generate with: npm run generate-secrets)
JWT_SECRET=your_secret
JWT_REFRESH_SECRET=your_refresh_secret

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Firebase
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY=your_private_key
FIREBASE_CLIENT_EMAIL=your_client_email

# Realtime fan-out (required when running multiple server instances)
REDIS_URL=redis://localhost:6379
REALTIME_MAX_CONNECTIONS_PER_USER=4
REWIND_ASYNC_CHAT_ENABLED=true
REWIND_AUTONOMOUS_CHAT_ENABLED=true

# Gemini AI
GEMINI_API_KEY=your_gemini_key
```

## 🌐 API Endpoints

### Health & Info

- `GET /api` - API information
- `GET /api/health` - Health check

### Authentication

- `POST /api/v1/auth/register` - Register user
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/google` - Google OAuth
- `POST /api/v1/auth/refresh` - Refresh token

### Users

- `GET /api/v1/users/me` - Get current user
- `PATCH /api/v1/users/me` - Update profile
- `POST /api/v1/users/fcm-token` - Register FCM token

### Goals

- `GET /api/v1/goals` - List goals
- `POST /api/v1/goals` - Create goal
- `PATCH /api/v1/goals/:id` - Update goal
- `DELETE /api/v1/goals/:id` - Delete goal
- `POST /api/v1/goals/:id/checkin` - Check in

### Achievements

- `GET /api/v1/achievements` - List achievements

### Notifications

- `GET /api/v1/notifications` - List notifications
- `PATCH /api/v1/notifications/:id/read` - Mark as read

### Chill Sessions

- `POST /api/v1/chill` - Start session
- `PATCH /api/v1/chill/:id/complete` - Complete session

### Journals

- `GET /api/v1/journals` - List entries
- `POST /api/v1/journals` - Create entry
- `PATCH /api/v1/journals/:id` - Update entry

### Insights

- `GET /api/v1/insights/emotion-summary` - AI emotion analysis
- `GET /api/v1/insights/journal-summary` - Journal insights

### Upload

- `POST /api/v1/upload/avatar` - Upload avatar

## 🧪 Testing

```bash
# Run tests (when implemented)
npm test

# Test with curl
curl http://localhost:4000/api/health
```

## 🚢 Deployment

See [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) for detailed deployment guides:

- AWS ECS
- Google Cloud Run
- DigitalOcean App Platform
- Heroku
- Custom VPS

## 📊 Database Schema

Key models:

- **User** - User accounts and profiles
- **Goal** - User goals and tracking
- **CheckIn** - Daily check-ins
- **Achievement** - Earned badges
- **Notification** - Push notifications
- **ChillSession** - Meditation/chill sessions
- **Journal** - Journal entries

See `prisma/schema.prisma` for full schema.

## 🔒 Security

- JWT-based authentication
- Password hashing with bcrypt
- Environment variable configuration
- Non-root Docker user
- Input validation with Zod
- CORS enabled

## 🐛 Troubleshooting

### Common Issues

**Port already in use:**

```bash
lsof -ti:4000 | xargs kill -9
# or change PORT in .env
```

**Database connection error:**

```bash
# Check DATABASE_URL format
# For Docker: use 'postgres' as hostname
# For local: use 'localhost'
```

**Prisma client not generated:**

```bash
npx prisma generate
```

**Docker issues:**
See [DOCKER_QUICK_START.md](./DOCKER_QUICK_START.md#-troubleshooting)

## 📖 Additional Resources

- [Express Documentation](https://expressjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Docker Documentation](https://docs.docker.com/)

## 🤝 Contributing

1. Create feature branch
2. Make changes
3. Test thoroughly
4. Submit pull request

## 📄 License

[Your License Here]

## 👥 Authors

[Your Team/Name Here]

---

**Need help?** Check the documentation files or open an issue!
