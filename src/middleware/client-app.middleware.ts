import type { NextFunction, Request, Response } from "express";
import type { ClientApp } from "../types/client-app.type";

const MYCOVE_PATH_PREFIX = "/mycove";

export function getClientAppFromPath(path: string): ClientApp {
  return path === MYCOVE_PATH_PREFIX ||
    path.startsWith(`${MYCOVE_PATH_PREFIX}/`)
    ? "mycove"
    : "vybaa";
}

export function setClientApp(req: Request, clientApp: ClientApp): void {
  req.clientApp = clientApp;
}

export function clientAppMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  setClientApp(req, getClientAppFromPath(req.path));
  next();
}
