import { NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";

type ValidationTarget = "body" | "params" | "query";

export function validate(schema: z.ZodSchema, target: ValidationTarget = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = target === "body" ? req.body : target === "params" ? req.params : req.query;
      schema.parse(data);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));

        console.log(errors)

        return res.status(400).json({
          msg: "Validation failed:"+(errors?.[0] as any)?.message,
          errors,
        });
      }

      return res.status(400).json({
        msg: "Invalid request data",
      });
    }
  };
}
