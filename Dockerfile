# Use a slim Node image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy dependency files first (better caching)
COPY package*.json ./

# Install Node dependencies
RUN npm install --legacy-peer-deps



# Copy the rest of your app
COPY . .

# Build TypeScript (if applicable)
RUN npm run build

# Expose port (change if needed)
EXPOSE 8000

# Temporary launch override. Set to true in the deployment environment to
# restore RevenueCat-backed Vybaa Pro enforcement without another code change.
ENV VYBAA_PRO_CHECKS_ENABLED=false

# Start the app
CMD ["node", "dist/server.js"]
