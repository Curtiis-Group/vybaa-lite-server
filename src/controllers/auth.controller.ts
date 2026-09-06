import type { User } from "@prisma/client";
import type { Request, Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import { emailService } from "../services/email.service";
import { getRewindPartnerSwitchAvailability } from "../services/rewind-partner-switch.service";
import { userMoodService } from "../services/user-mood.service";
import {
  comparePassword,
  generateAccessToken,
  generateOTP,
  generateRefreshToken,
  hashPassword,
  isOTPExpired,
  verifyGoogleToken,
  verifyRefreshToken,
} from "../utils/auth.util";
import { uploadImageFromUrl } from "../utils/cloudinary.util";
import logger from "../utils/logger.util";
import { generateUniqueUsername } from "../utils/username.util";

export type FormattedUserResponse = {
  avatarUrl: string | undefined;
  createdAt: string;
  currentMood: string | undefined;
  email: string;
  firstName: string | undefined;
  id: string;
  isConfirmed: boolean;
  isFirstTime: boolean;
  lastName: string | undefined;
  lastUsernameChangeAt: string | undefined;
  rewindPersona: string | undefined;
  rewindPersonaCanChange: boolean;
  rewindPersonaNextChangeAt: string | undefined;
  rewindPersonalizationEnabled: boolean;
  rewindProactiveChatEnabled: boolean;
  rewindProactiveChatExplainedAt: string | undefined;
  timezone: string;
  updatedAt: string;
  username: string | undefined;
};

// Helper function to format user response
export function formatUserResponse(user: User): FormattedUserResponse {
  const partnerSwitch = getRewindPartnerSwitchAvailability(
    user.rewindPersonaChangedAt,
    user.timezone,
  );

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName || undefined,
    lastName: user.lastName || undefined,
    username: user.username || undefined,
    avatarUrl: user.avatarUrl || undefined,
    currentMood: user.currentMood || undefined,
    rewindPersona: user.rewindPersona || undefined,
    rewindPersonaCanChange: partnerSwitch.canChange,
    rewindPersonaNextChangeAt:
      partnerSwitch.nextAvailableAt?.toISOString() || undefined,
    rewindPersonalizationEnabled: user.rewindPersonalizationEnabled ?? true,
    rewindProactiveChatEnabled: user.rewindProactiveChatEnabled ?? true,
    rewindProactiveChatExplainedAt:
      user.rewindProactiveChatExplainedAt?.toISOString() || undefined,
    timezone: user.timezone || "UTC",
    isConfirmed: user.isConfirmed,
    isFirstTime: user.isFirstTime,
    lastUsernameChangeAt: user.lastUsernameChangeAt?.toISOString() || undefined,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.password) {
      return res.status(401).json({ msg: "Invalid credentials" });
    }

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ msg: "Invalid credentials" });
    }

    await userMoodService.refreshCurrentMoodIfNeeded(user.id);

    const refreshedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!refreshedUser) {
      return res.status(404).json({ msg: "User not found" });
    }

    const token = generateAccessToken(refreshedUser.id);
    const refreshToken = generateRefreshToken(refreshedUser.id);

    // Update refresh token
    await prisma.user.update({
      where: { id: refreshedUser.id },
      data: {
        refreshToken,
      },
    });

    res.json({
      msg: "Login successful",
      data: {
        token,
        refreshToken,
        user: formatUserResponse(refreshedUser),
      },
    });
  } catch (error) {
    logger.error("Login error:", { error, email: req.body.email });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function register(req: Request, res: Response) {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ msg: "User already exists" });
    }

    const hashedPassword = await hashPassword(password);

    // Generate unique username from first name or email
    const baseName = firstName || email.split("@")[0];
    const username = await generateUniqueUsername(baseName);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        username,
        lastUsernameChangeAt: new Date(), // Set initial change date
        isConfirmed: false,
        isFirstTime: true,
      },
    });

    // Generate tokens
    const token = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken },
    });

    res.json({
      msg: "Registration successful. Please confirm your email.",
      data: {
        user: formatUserResponse(user),
        confirmationRequired: true,
      },
    });
  } catch (error: any) {
    logger.error("Register error:", { error, email: req.body.email });
    if (error.code === "P2002") {
      return res.status(400).json({ msg: "User already exists" });
    }
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function googleAuth(req: Request, res: Response) {
  try {
    const { token } = req.body;

    // Verify Google token
    const googleUser = await verifyGoogleToken(token, req.clientApp);
    if (!googleUser) {
      return res.status(401).json({ msg: "Invalid Google token" });
    }

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    if (!user) {
      // Create new user
      const nameParts = googleUser.name?.split(" ") || [];
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      // Generate unique username
      const baseName = firstName || googleUser.email.split("@")[0];
      const username = await generateUniqueUsername(baseName);

      // Upload Google avatar to Cloudinary (async, non-blocking)
      let cloudinaryAvatarUrl: string | undefined = undefined;
      if (googleUser.picture) {
        try {
          const uploadedUrl = await uploadImageFromUrl(
            googleUser.picture,
            googleUser.sub, // Use Google ID as temp ID
            "google-avatars",
          );
          cloudinaryAvatarUrl = uploadedUrl || undefined;
        } catch (error) {
          logger.warn(
            "Failed to upload Google avatar to Cloudinary, using Google URL",
            {
              email: googleUser.email,
              error,
            },
          );
          cloudinaryAvatarUrl = googleUser.picture || undefined;
        }
      }

      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          firstName,
          lastName,
          username,
          googleId: googleUser.sub,
          avatarUrl: cloudinaryAvatarUrl,
          isConfirmed: true, // Google users are pre-verified
          isFirstTime: true,
          lastUsernameChangeAt: new Date(), // Set initial change date
        },
      });
    } else {
      // Update existing user
      if (!user.googleId) {
        const nameParts = googleUser.name?.split(" ") || [];
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";

        // Upload avatar to Cloudinary if available
        let cloudinaryAvatarUrl = user.avatarUrl;
        if (googleUser.picture && !user.avatarUrl) {
          try {
            const uploadedUrl = await uploadImageFromUrl(
              googleUser.picture,
              user.id,
              "google-avatars",
            );
            cloudinaryAvatarUrl =
              uploadedUrl || googleUser.picture || undefined;
          } catch (error) {
            logger.warn("Failed to upload Google avatar to Cloudinary", {
              userId: user.id,
              error,
            });
            cloudinaryAvatarUrl =
              googleUser.picture || user.avatarUrl || undefined;
          }
        }

        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: googleUser.sub,
            firstName: user.firstName || firstName || undefined,
            lastName: user.lastName || lastName || undefined,
            avatarUrl: cloudinaryAvatarUrl,
          },
        });
      } else {
        // Update avatar if available and not already set
        if (googleUser.picture && !user.avatarUrl) {
          try {
            const uploadedUrl = await uploadImageFromUrl(
              googleUser.picture,
              user.id,
              "google-avatars",
            );
            const cloudinaryAvatarUrl = uploadedUrl || googleUser.picture;

            user = await prisma.user.update({
              where: { id: user.id },
              data: {
                avatarUrl: cloudinaryAvatarUrl,
              },
            });
          } catch (error) {
            logger.warn("Failed to upload Google avatar to Cloudinary", {
              userId: user.id,
              error,
            });
            // Use Google URL as fallback
            user = await prisma.user.update({
              where: { id: user.id },
              data: {
                avatarUrl: googleUser.picture,
              },
            });
          }
        }
      }
    }

    // Generate tokens
    await userMoodService.refreshCurrentMoodIfNeeded(user.id);

    const refreshedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!refreshedUser) {
      return res.status(404).json({ msg: "User not found" });
    }

    const accessToken = generateAccessToken(refreshedUser.id);
    const refreshToken = generateRefreshToken(refreshedUser.id);

    await prisma.user.update({
      where: { id: refreshedUser.id },
      data: { refreshToken },
    });

    res.json({
      msg: "Google login successful",
      data: {
        token: accessToken,
        refreshToken,
        user: formatUserResponse(refreshedUser),
      },
    });
  } catch (error) {
    logger.error("Google auth error:", { error });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    await userMoodService.refreshCurrentMoodIfNeeded(userId);

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      msg: "Session retrieved",
      data: {
        isFirstTime: user.isFirstTime,
        user: formatUserResponse(user),
      },
    });
  } catch (error) {
    logger.error("Session error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function refreshToken(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body;

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({ msg: "Invalid refresh token" });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ msg: "Invalid refresh token" });
    }

    // Generate new tokens
    const newToken = generateAccessToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: newRefreshToken },
    });

    res.json({
      msg: "Token refreshed",
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    logger.error("Refresh token error:", { error });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function logout(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    // Clear refresh token
    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    res.json({ msg: "Logout successful" });
  } catch (error) {
    logger.error("Logout error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function requestPasswordReset(req: Request, res: Response) {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Generate OTP
    const otpCode = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode,
        otpExpiresAt,
      },
    });

    // Send OTP via email
    await emailService.sendPasswordResetEmail({
      to: user.email,
      name: user.firstName || user.email,
      code: otpCode,
    });

    res.json({
      msg: "OTP sent to email",
      data: {
        user: {
          requestedConfirmation: true,
        },
      },
    });
  } catch (error) {
    logger.error("Request validation error:", { error, email: req.body.email });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function verifyRecoveryCode(req: Request, res: Response) {
  try {
    const { email, otp } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.otpCode || user.otpCode !== otp.toString()) {
      return res.status(401).json({ msg: "Invalid OTP" });
    }

    if (isOTPExpired(user.otpExpiresAt)) {
      return res.status(401).json({ msg: "OTP has expired" });
    }

    res.json({
      msg: "OTP verified",
      data: {
        isValid: true,
      },
    });
  } catch (error) {
    logger.error("Verify recovery code error:", {
      error,
      email: req.body.email,
    });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function recoverAccount(req: Request, res: Response) {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.otpCode || user.otpCode !== otp.toString()) {
      return res.status(400).json({ msg: "Invalid OTP" });
    }

    if (isOTPExpired(user.otpExpiresAt)) {
      return res.status(400).json({ msg: "OTP has expired" });
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    res.json({
      msg: "Password reset successful",
      data: {
        user: {
          isRecovered: true,
        },
      },
    });
  } catch (error) {
    logger.error("Recover account error:", { error, email: req.body.email });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function requestConfirmation(req: Request, res: Response) {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Generate OTP
    const otpCode = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode,
        otpExpiresAt,
      },
    });

    // Send confirmation OTP via email
    await emailService.sendConfirmationEmail({
      to: user.email,
      name: user.firstName || user.email,
      code: otpCode,
    });

    res.json({
      msg: "Confirmation OTP sent",
      data: {
        user: {
          requestedConfirmation: true,
        },
      },
    });
  } catch (error) {
    logger.error("Request confirmation error:", {
      error,
      email: req.body.email,
    });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function accountConfirmation(req: Request, res: Response) {
  try {
    const { email, otp } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.otpCode || user.otpCode !== otp.toString()) {
      return res.status(401).json({ msg: "Invalid OTP" });
    }

    if (isOTPExpired(user.otpExpiresAt)) {
      return res.status(401).json({ msg: "OTP has expired" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isConfirmed: true,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    res.json({
      msg: "Account confirmed successfully",
      data: {
        user: formatUserResponse(user),
      },
    });
  } catch (error) {
    logger.error("Account confirmation error:", {
      error,
      email: req.body.email,
    });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function checkEmail(req: Request, res: Response) {
  try {
    const { email } = req.params;

    const user = await prisma.user.findUnique({
      where: { email: String(email) },
    });

    res.json({
      msg: "Email check completed",
      data: {
        available: !user,
      },
    });
  } catch (error) {
    logger.error("Email check error:", { error, email: req.params.email });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function changePassword(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.password) {
      return res.status(404).json({ msg: "User not found or no password set" });
    }

    const isPasswordValid = await comparePassword(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      return res.status(401).json({ msg: "Current password is incorrect" });
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    res.json({ msg: "Password changed successfully" });
  } catch (error) {
    logger.error("Change password error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getSuggestions(req: AuthRequest, res: Response) {
  try {
    // TODO: Implement AI suggestions based on user answers
    // For now, return empty suggestions (removed task/journal references for simple lock-in app)
    res.json({
      msg: "Suggestions generated",
      data: {
        suggestedGoals: [],
      },
    });
  } catch (error) {
    logger.error("Suggestions error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function completeOnboarding(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { username } = req.body;

    const updateData: any = {
      isFirstTime: false,
    };

    if (username !== undefined) updateData.username = username;

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    res.json({
      msg: "Onboarding completed",
      data: {
        user: formatUserResponse(user),
      },
    });
  } catch (error: any) {
    logger.error("Onboarding error:", { error, userId: req.userId });
    if (error.code === "P2002") {
      return res.status(400).json({ msg: "Username already taken" });
    }
    res.status(500).json({ msg: "Internal server error" });
  }
}
