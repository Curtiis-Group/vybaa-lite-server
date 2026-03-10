"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const zod_1 = require("zod");
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
                console.log(errors);
                return res.status(400).json({
                    msg: "Validation failed:" + errors?.[0]?.message,
                    errors,
                });
            }
            return res.status(400).json({
                msg: "Invalid request data",
            });
        }
    };
}
