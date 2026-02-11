.PHONY: help build up down logs restart clean dev prod migrate db-push db-studio shell db-shell

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build Docker images
	docker-compose build

up: ## Start production services
	docker-compose up -d

dev: ## Start development services with hot-reload
	docker-compose --profile dev up server-dev

down: ## Stop all services
	docker-compose down

logs: ## Show logs from all services
	docker-compose logs -f

logs-server: ## Show server logs only
	docker-compose logs -f server

logs-db: ## Show database logs only
	docker-compose logs -f postgres

restart: ## Restart all services
	docker-compose restart

restart-server: ## Restart server only
	docker-compose restart server

clean: ## Stop services and remove volumes (WARNING: deletes database data)
	docker-compose down -v

rebuild: ## Rebuild images from scratch
	docker-compose build --no-cache
	docker-compose up -d

prod: ## Start in production mode
	@echo "Starting in production mode..."
	docker-compose up -d postgres
	@echo "Waiting for database..."
	@sleep 5
	docker-compose up -d server

migrate: ## Run Prisma migrations
	docker-compose exec server npx prisma migrate deploy

migrate-dev: ## Run Prisma migrations in dev mode
	docker-compose exec server-dev npx prisma migrate dev

db-push: ## Push Prisma schema changes
	docker-compose exec server npx prisma db push

db-studio: ## Open Prisma Studio
	docker-compose exec server npx prisma studio

generate: ## Generate Prisma client
	docker-compose exec server npx prisma generate

shell: ## Open shell in server container
	docker-compose exec server sh

shell-dev: ## Open shell in dev server container
	docker-compose exec server-dev sh

db-shell: ## Open PostgreSQL shell
	docker-compose exec postgres psql -U vybaa -d vybaa_db

status: ## Show status of all containers
	docker-compose ps

setup: ## Initial setup (copy env template)
	@if [ ! -f .env ]; then \
		cp env.template .env; \
		echo "✓ Created .env file from template"; \
		echo "⚠ Please edit .env and add your credentials"; \
	else \
		echo "⚠ .env file already exists"; \
	fi

install: setup build up migrate ## Complete installation (setup, build, start, migrate)
	@echo "✓ Installation complete!"
	@echo "Server should be running on http://localhost:4000"
