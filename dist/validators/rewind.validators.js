"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLiveTokenSchema = void 0;
const zod_1 = require("zod");
exports.createLiveTokenSchema = zod_1.z.object({
    personaId: zod_1.z.enum(["ella", "lyra", "jake", "ariel"]),
});
