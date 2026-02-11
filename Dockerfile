# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package*.json pnpm-lock.yaml* ./

# Install dependencies with pnpm (faster than npm)
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile

# Development stage
FROM base AS dev
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose port
EXPOSE 4000

# Start development server
CMD ["npm", "run", "dev"]

# Build stage
FROM base AS builder
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./

# Copy source code and configs
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npx tsc

# Production stage
FROM base AS production
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files and install production dependencies only
COPY package*.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile

# Copy built app from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create logs directory and set permissions
RUN mkdir -p logs && chown -R nodejs:nodejs logs

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start production server
CMD ["node", "dist/server.js"]
