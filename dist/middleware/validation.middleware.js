"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const zod_1 = require("zod");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
function validate(schema, target = "body") {
    return (req, res, next) => {
        try {
            const data = target === "body" ? req.body : target === "params" ? req.params : req.query;
            schema.parse(data);
            next();
        }
        catch (error) {
            if (error instanceof zod_1.ZodError) {
                const errors = error.errors.map((err) => ({
                    field: err.path.join("."),
                    message: err.message,
                }));
                logger_util_1.default.warn("Request validation failed", {
                    errors,
                    method: req.method,
                    path: req.path,
                });
                return res.status(400).json({
                    msg: `Validation failed: ${errors[0]?.message ?? "Invalid request data"}`,
                    errors,
                });
            }
            return res.status(400).json({
                msg: "Invalid request data",
            });
        }
    };
}
