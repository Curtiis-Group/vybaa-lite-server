# 🚀 Docker Deployment Guide

This guide covers deploying the Vybaa server using Docker in various environments.

## Table of Contents

1. [Local Development](#local-development)
2. [Staging/Production Deployment](#stagingproduction-deployment)
3. [Cloud Deployments](#cloud-deployments)
4. [CI/CD Integration](#cicd-integration)
5. [Monitoring & Maintenance](#monitoring--maintenance)

---

## Local Development

See [DOCKER_QUICK_START.md](./DOCKER_QUICK_START.md) for quick local setup.

---

## Staging/Production Deployment

### Prerequisites

1. A server/VM with Docker and Docker Compose installed
2. Domain name pointing to your server
3. SSL certificate (use Let's Encrypt with Certbot)
4. All required API keys and credentials

### Deployment Steps

#### 1. Clone Repository

```bash
ssh user@your-server.com
git clone https://github.com/your-org/vybaa-lite.git
cd vybaa-lite/server
```

#### 2. Configure Environment

```bash
# Create production environment file
cp env.template .env

# Generate secure secrets
node scripts/generate-secrets.js

# Edit .env with production values
nano .env
```

**Important Production Settings:**
```bash
NODE_ENV=production
PORT=4000

# Use strong, unique passwords
POSTGRES_PASSWORD=<strong-random-password>
JWT_SECRET=<generated-secret>
JWT_REFRESH_SECRET=<generated-secret>

# Production database URL
DATABASE_URL=postgresql://vybaa:${POSTGRES_PASSWORD}@postgres:5432/vybaa_db?schema=public
```

#### 3. Start Services

```bash
# Build and start
docker-compose up -d

# Run migrations
docker-compose exec server npx prisma migrate deploy

# Check status
docker-compose ps
```

#### 4. Configure Reverse Proxy (Nginx)

Create `/etc/nginx/sites-available/vybaa-api`:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/vybaa-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 5. Setup SSL with Certbot

```bash
sudo certbot --nginx -d api.yourdomain.com
```

#### 6. Setup Automatic Backups

Create backup script `/opt/scripts/backup-vybaa-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/vybaa"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

docker-compose exec -T postgres pg_dump -U vybaa vybaa_db | \
    gzip > $BACKUP_DIR/vybaa_db_$DATE.sql.gz

# Keep only last 30 days of backups
find $BACKUP_DIR -name "vybaa_db_*.sql.gz" -mtime +30 -delete
```

Add to crontab:
```bash
# Daily backup at 2 AM
0 2 * * * /opt/scripts/backup-vybaa-db.sh
```

---

## Cloud Deployments

### AWS ECS

1. **Build and push image to ECR:**

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker build -t vybaa-server:latest ./server
docker tag vybaa-server:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/vybaa-server:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/vybaa-server:latest
```

2. **Create RDS PostgreSQL instance**
3. **Create ECS Task Definition** with environment variables
4. **Create ECS Service** with load balancer

### Google Cloud Run

```bash
# Build and push to GCR
gcloud builds submit --tag gcr.io/PROJECT-ID/vybaa-server ./server

# Deploy to Cloud Run
gcloud run deploy vybaa-server \
  --image gcr.io/PROJECT-ID/vybaa-server \
  --platform managed \
  --region us-central1 \
  --set-env-vars "$(cat .env | grep -v '^#' | xargs)" \
  --allow-unauthenticated
```

### DigitalOcean App Platform

1. **Create `app.yaml`:**

```yaml
name: vybaa-server
services:
  - name: api
    dockerfile_path: server/Dockerfile
    source_dir: /
    github:
      repo: your-org/vybaa-lite
      branch: main
    health_check:
      http_path: /api/health
    envs:
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
      - key: JWT_SECRET
        type: SECRET
    http_port: 4000

databases:
  - name: db
    engine: PG
    version: "16"
```

2. **Deploy:**

```bash
doctl apps create --spec app.yaml
```

### Heroku

```bash
# Create app
heroku create vybaa-server

# Add PostgreSQL
heroku addons:create heroku-postgresql:standard-0

# Set buildpacks
heroku buildpacks:set heroku/nodejs

# Deploy
git subtree push --prefix server heroku main

# Run migrations
heroku run npx prisma migrate deploy
```

---

## CI/CD Integration

### GitHub Actions

See `.github/workflows/docker-build.yml.example` for a complete workflow.

Key steps:
1. Build Docker image
2. Run tests
3. Security scan with Trivy
4. Push to container registry
5. Deploy to production

### GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - build
  - deploy

build:
  stage: build
  image: docker:latest
  services:
    - docker:dind
  script:
    - cd server
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

deploy:
  stage: deploy
  script:
    - ssh user@server "cd vybaa-lite/server && docker-compose pull && docker-compose up -d"
  only:
    - main
```

---

## Monitoring & Maintenance

### Health Monitoring

```bash
# Basic health check
curl https://api.yourdomain.com/api/health

# Setup monitoring with UptimeRobot, Pingdom, or similar
```

### Log Management

```bash
# View logs
docker-compose logs -f --tail=100

# Use log aggregation (ELK, Datadog, etc.)
```

### Resource Monitoring

Add to `docker-compose.yml`:

```yaml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### Update Procedure

```bash
# 1. Backup database
docker-compose exec postgres pg_dump -U vybaa vybaa_db > backup.sql

# 2. Pull latest code
git pull origin main

# 3. Rebuild
docker-compose build --no-cache

# 4. Update with zero-downtime (if using multiple instances)
docker-compose up -d --no-deps --build server

# 5. Run migrations
docker-compose exec server npx prisma migrate deploy

# 6. Verify
curl https://api.yourdomain.com/api/health
```

### Rollback Procedure

```bash
# 1. Stop current version
docker-compose down

# 2. Checkout previous version
git checkout <previous-commit>

# 3. Rebuild and start
docker-compose build
docker-compose up -d

# 4. Restore database if needed
docker-compose exec -T postgres psql -U vybaa vybaa_db < backup.sql
```

---

## Security Best Practices

1. **Use secrets management:** AWS Secrets Manager, Vault, etc.
2. **Regular updates:** Keep Docker, Node.js, and dependencies updated
3. **Network isolation:** Use private networks for database
4. **Non-root user:** Already configured in Dockerfile
5. **Security scanning:** Use Trivy, Snyk, or similar
6. **Rate limiting:** Add rate limiting middleware
7. **HTTPS only:** Always use SSL in production
8. **Firewall:** Configure firewall rules (UFW, Security Groups)

---

## Performance Optimization

1. **Use multi-stage builds:** Already implemented
2. **Cache Docker layers:** Leverage BuildKit cache
3. **Database connection pooling:** Configure Prisma pool
4. **CDN for static assets:** Use CloudFront, Cloudflare
5. **Load balancing:** Use multiple server instances
6. **Database optimization:** Add indexes, optimize queries

---

## Troubleshooting Production Issues

### Server Not Starting

```bash
# Check logs
docker-compose logs server

# Check database connection
docker-compose exec server npx prisma db push --preview-feature
```

### High Memory Usage

```bash
# Check container stats
docker stats

# Adjust limits in docker-compose.yml
```

### Database Connection Issues

```bash
# Test database connection
docker-compose exec postgres psql -U vybaa -d vybaa_db -c "SELECT 1;"

# Check network
docker network inspect vybaa_vybaa-network
```

---

## Support

For issues and questions:
- Check logs: `docker-compose logs -f`
- Review [DOCKER_QUICK_START.md](./DOCKER_QUICK_START.md)
- Review [README.docker.md](./README.docker.md)

---

**Production Checklist:**

- [ ] Environment variables configured
- [ ] Database backed up
- [ ] SSL certificate installed
- [ ] Domain configured
- [ ] Monitoring setup
- [ ] Backups automated
- [ ] Secrets secured
- [ ] Firewall configured
- [ ] Logging configured
- [ ] Health checks working
