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

# Keep RevenueCat-backed Vybaa Pro enforcement enabled in every deployed image.
# An explicit deployment environment override can still be used for local
# troubleshooting, but production images must not grant Pro to every user.
ENV VYBAA_PRO_CHECKS_ENABLED=true

# Start the app
CMD ["node", "dist/server.js"]
