import type { ClientApp } from "./client-app.type";

declare global {
  namespace Express {
    interface Request {
      clientApp: ClientApp;
    }
  }
}

export {};
