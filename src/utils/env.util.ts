type Env = {
    PORT: number;
    JWT_SECRET?: string;
    JWT_REFRESH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    DATABASE_URL?: string;
}

export const Env: Env = {
    PORT: Number(process.env.PORT) || 4000,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    DATABASE_URL: process.env.DATABASE_URL,
    ...process.env as any
}