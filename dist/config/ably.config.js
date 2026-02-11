"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAblyClient = getAblyClient;
exports.generateAblyToken = generateAblyToken;
const ably_1 = __importDefault(require("ably"));
const env_util_1 = require("../utils/env.util");
let ablyClient = null;
function getAblyClient() {
    if (!ablyClient) {
        const ablyApiKey = env_util_1.Env.ABLY_API_KEY;
        if (!ablyApiKey) {
            throw new Error("ABLY_API_KEY is not configured");
        }
        ablyClient = new ably_1.default.Realtime(ablyApiKey);
    }
    return ablyClient;
}
// Generate token for client authentication
function generateAblyToken(userId) {
    const client = getAblyClient();
    return client.auth.createTokenRequest({
        clientId: userId,
    });
}
