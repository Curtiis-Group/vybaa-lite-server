import { z } from "zod";

// Common validation schemas
export const emailSchema = z.string().email("Invalid email format");
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password must be less than 100 characters");
export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name must be less than 100 characters");
export const otpSchema = z
  .union([
    z.string().length(6, "OTP must be 6 digits").regex(/^\d+$/, "OTP must contain only digits"),
    z.number().int().min(100000).max(999999),
  ])
  .transform((val) => (typeof val === "number" ? val.toString() : val));
export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(50, "Username must be less than 50 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores");

// Auth request validators
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
});

export const googleAuthSchema = z.object({
  token: z.string().min(1, "Google token is required"),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const logoutSchema = z.object({
  fcmToken: z.string().optional(),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const verifyOTPSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
  newPassword: passwordSchema,
});

export const requestConfirmationSchema = z.object({
  email: emailSchema,
});

export const accountConfirmationSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: "New password must be different from current password",
  path: ["newPassword"],
});

export const onboardingAnswerSchema = z.object({
  question: z.string().min(1, "Question is required"),
  answer: z.string().min(1, "Answer is required"),
});

export const onboardingSchema = z.object({
  answers: z.array(onboardingAnswerSchema).optional(),
  username: usernameSchema.optional(),
  currentMood: z.string().optional(),
  lifeGoal: z.string().optional(),
});

export const suggestionsSchema = z.object({
  answers: z.array(onboardingAnswerSchema).optional(),
  currentMood: z.string().optional(),
  lifeGoal: z.string().optional(),
});

// User validators
export const updateProfileSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  username: usernameSchema.optional(),
  profileImageId: z.string().optional(),
  currentMood: z.string().max(200, "Current mood must be less than 200 characters").optional(),
  lifeGoal: z.string().max(500, "Life goal must be less than 500 characters").optional(),
  rewindPersona: z.enum(["ella", "lyra", "jake", "ariel"]).nullable().optional(),
});

// Params validators
export const emailParamSchema = z.object({
  email: emailSchema,
});
