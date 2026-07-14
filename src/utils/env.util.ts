export enum ENVIRONMENT {
    LOCAL = "local",
    DEVELOPMENT = "development",
    PRODUCTION = "production"
}

type Env = {
    PORT: number;
    JWT_SECRET?: string;
    JWT_REFRESH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    DATABASE_URL?: string;
    CLOUDINARY_CLOUD_NAME?: string
    CLOUDINARY_API_KEY?: string
    CLOUDINARY_API_SECRET?: string

    FIREBASE_PROJECT_ID?: string
    FIREBASE_PRIVATE_KEY?: string
    FIREBASE_CLIENT_EMAIL?: string
    ABLY_API_KEY?: string
    GEMINI_API_KEY?: string;
    REVENUECAT_REST_API_KEY?: string;
    ENVIRONMENT: ENVIRONMENT
}

export const Env: Env = {
    PORT: Number(process.env.PORT) || 4000,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    DATABASE_URL: process.env.DATABASE_URL,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,

    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,

    ABLY_API_KEY: process.env.ABLY_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    REVENUECAT_REST_API_KEY: process.env.REVENUECAT_REST_API_KEY,

    ...process.env as any
}
