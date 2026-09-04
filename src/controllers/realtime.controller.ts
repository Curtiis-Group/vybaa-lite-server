import type { Response } from "express";

import type { AuthRequest } from "../middleware/auth.middleware";
import { createRealtimeSocketToken } from "../services/realtime-websocket.service";

export function createRealtimeToken(req: AuthRequest, res: Response): void {
  res.json({
    data: createRealtimeSocketToken(req.userId!),
    msg: "Realtime connection ready",
  });
}
