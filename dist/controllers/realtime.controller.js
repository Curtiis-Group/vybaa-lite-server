"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRealtimeToken = createRealtimeToken;
const realtime_websocket_service_1 = require("../services/realtime-websocket.service");
function createRealtimeToken(req, res) {
    res.json({
        data: (0, realtime_websocket_service_1.createRealtimeSocketToken)(req.userId),
        msg: "Realtime connection ready",
    });
}
