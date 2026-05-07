"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailParamSchema = exports.updateProfileSchema = exports.suggestionsSchema = exports.onboardingSchema = exports.onboardingAnswerSchema = exports.changePasswordSchema = exports.accountConfirmationSchema = exports.requestConfirmationSchema = exports.resetPasswordSchema = exports.verifyOTPSchema = exports.requestPasswordResetSchema = exports.logoutSchema = exports.refreshTokenSchema = exports.googleAuthSchema = exports.registerSchema = exports.loginSchema = exports.usernameSchema = exports.otpSchema = exports.nameSchema = exports.passwordSchema = exports.emailSchema = void 0;
const zod_1 = require("zod");
// Common validation schemas
exports.emailSchema = zod_1.z.string().email("Invalid email format");
exports.passwordSchema = zod_1.z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters");
exports.nameSchema = zod_1.z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be less than 100 characters");
exports.otpSchema = zod_1.z
    .union([
    zod_1.z.string().length(6, "OTP must be 6 digits").regex(/^\d+$/, "OTP must contain only digits"),
    zod_1.z.number().int().min(100000).max(999999),
])
    .transform((val) => (typeof val === "number" ? val.toString() : val));
exports.usernameSchema = zod_1.z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be less than 50 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores");
// Auth request validators
exports.loginSchema = zod_1.z.object({
    email: exports.emailSchema,
    password: zod_1.z.string().min(1, "Password is required"),
});
exports.registerSchema = zod_1.z.object({
    email: exports.emailSchema,
    password: exports.passwordSchema,
    firstName: exports.nameSchema.optional(),
    lastName: exports.nameSchema.optional(),
});
exports.googleAuthSchema = zod_1.z.object({
    token: zod_1.z.string().min(1, "Google token is required"),
});
exports.refreshTokenSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(1, "Refresh token is required"),
});
exports.logoutSchema = zod_1.z.object({
    fcmToken: zod_1.z.string().optional(),
});
exports.requestPasswordResetSchema = zod_1.z.object({
    email: exports.emailSchema,
});
exports.verifyOTPSchema = zod_1.z.object({
    email: exports.emailSchema,
    otp: exports.otpSchema,
});
exports.resetPasswordSchema = zod_1.z.object({
    email: exports.emailSchema,
    otp: exports.otpSchema,
    newPassword: exports.passwordSchema,
});
exports.requestConfirmationSchema = zod_1.z.object({
    email: exports.emailSchema,
});
exports.accountConfirmationSchema = zod_1.z.object({
    email: exports.emailSchema,
    otp: exports.otpSchema,
});
exports.changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1, "Current password is required"),
    newPassword: exports.passwordSchema,
}).refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
});
exports.onboardingAnswerSchema = zod_1.z.object({
    question: zod_1.z.string().min(1, "Question is required"),
    answer: zod_1.z.string().min(1, "Answer is required"),
});
exports.onboardingSchema = zod_1.z.object({
    answers: zod_1.z.array(exports.onboardingAnswerSchema).optional(),
    username: exports.usernameSchema.optional(),
});
exports.suggestionsSchema = zod_1.z.object({
    answers: zod_1.z.array(exports.onboardingAnswerSchema).optional(),
});
// User validators
exports.updateProfileSchema = zod_1.z.object({
    firstName: exports.nameSchema.optional(),
    lastName: exports.nameSchema.optional(),
    username: exports.usernameSchema.optional(),
    profileImageId: zod_1.z.string().optional(),
    rewindPersona: zod_1.z.enum(["ella", "lyra", "jake", "ariel"]).nullable().optional(),
});
// Params validators
exports.emailParamSchema = zod_1.z.object({
    email: exports.emailSchema,
});
