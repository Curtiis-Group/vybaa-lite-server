"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_util_1 = require("./env.util");
const config = {
    PORT: env_util_1.Env.PORT || 4000
};
exports.default = config;
