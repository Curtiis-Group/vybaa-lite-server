-- Database initialization script
-- This file is used by docker-compose to initialize the database

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Set timezone
SET timezone = 'UTC';

-- Log initialization
SELECT 'Database initialized successfully!' AS message;
