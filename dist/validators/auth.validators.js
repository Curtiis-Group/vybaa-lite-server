"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailParamSchema = exports.updateProfileSchema = exports.suggestionsSchema = exports.onboardingSchema = exports.onboardingAnswerSchema = exports.changePasswordSchema = exports.accountConfirmationSchema = exports.requestConfirmationSchema = exports.resetPasswordSchema = exports.verifyOTPSchema = exports.requestPasswordResetSchema = exports.logoutSchema = exports.refreshTokenSchema = exports.appleAuthSchema = exports.googleAuthSchema = exports.registerSchema = exports.loginSchema = exports.usernameSchema = exports.otpSchema = exports.nameSchema = exports.passwordSchema = exports.emailSchema = void 0;
const zod_1 = require("zod");
const legal_constants_1 = require("../constants/legal.constants");
const content_moderation_util_1 = require("../utils/content-moderation.util");
const termsConsentSchema = {
    acceptedTerms: zod_1.z.literal(true, {
        errorMap: () => ({ message: "You must accept the Terms of Use" }),
    }),
    termsVersion: zod_1.z.literal(legal_constants_1.CURRENT_TERMS_VERSION, {
        errorMap: () => ({ message: "Please accept the current Terms of Use" }),
    }),
};
// Common validation schemas
exports.emailSchema = zod_1.z.string().email("Invalid email format");
exports.passwordSchema = zod_1.z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters");
exports.nameSchema = zod_1.z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be less than 100 characters")
    .refine(content_moderation_util_1.isAllowedUserContent, "This name contains content that is not allowed");
exports.otpSchema = zod_1.z
    .union([
    zod_1.z
        .string()
        .length(6, "OTP must be 6 digits")
        .regex(/^\d+$/, "OTP must contain only digits"),
    zod_1.z.number().int().min(100000).max(999999),
])
    .transform((val) => (typeof val === "number" ? val.toString() : val));
exports.usernameSchema = zod_1.z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be less than 50 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
    .refine(content_moderation_util_1.isAllowedUserContent, "This username contains content that is not allowed");
// Auth request validators
exports.loginSchema = zod_1.z.object({
    ...termsConsentSchema,
    email: exports.emailSchema,
    password: zod_1.z.string().min(1, "Password is required"),
});
exports.registerSchema = zod_1.z.object({
    ...termsConsentSchema,
    email: exports.emailSchema,
    password: exports.passwordSchema,
    firstName: exports.nameSchema.optional(),
    lastName: exports.nameSchema.optional(),
});
exports.googleAuthSchema = zod_1.z.object({
    ...termsConsentSchema,
    token: zod_1.z.string().min(1, "Google token is required"),
});
exports.appleAuthSchema = zod_1.z.object({
    ...termsConsentSchema,
    familyName: exports.nameSchema.optional(),
    firstName: exports.nameSchema.optional(),
    token: zod_1.z.string().min(1, "Apple identity token is required"),
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
exports.changePasswordSchema = zod_1.z
    .object({
    currentPassword: zod_1.z.string().min(1, "Current password is required"),
    newPassword: exports.passwordSchema,
})
    .refine((data) => data.currentPassword !== data.newPassword, {
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
    rewindPersona: zod_1.z
        .enum(["ella", "lyra", "jake", "ariel", "tobi", "neeja"])
        .nullable()
        .optional(),
    rewindPersonalizationEnabled: zod_1.z.boolean().optional(),
    rewindProactiveChatEnabled: zod_1.z.boolean().optional(),
    rewindProactiveChatExplainedAt: zod_1.z.string().datetime().nullable().optional(),
    timezone: zod_1.z.string().min(1).max(64).optional(),
});
// Params validators
exports.emailParamSchema = zod_1.z.object({
    email: exports.emailSchema,
});
