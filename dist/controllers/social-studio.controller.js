"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStudio = getStudio;
exports.startXOAuth = startXOAuth;
exports.xOAuthCallback = xOAuthCallback;
exports.updatePreferences = updatePreferences;
exports.updateActivityConsent = updateActivityConsent;
exports.refreshSuggestions = refreshSuggestions;
exports.disconnectX = disconnectX;
exports.syncMentions = syncMentions;
exports.generatePostDraft = generatePostDraft;
exports.generateReplyDraft = generateReplyDraft;
exports.updateDraft = updateDraft;
exports.discardDraft = discardDraft;
exports.publishDraft = publishDraft;
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const social_studio_service_1 = require("../services/social-studio.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
function sendSocialError(error, req, res, operation) {
    if (error instanceof social_studio_service_1.SocialStudioError) {
        res.status(error.status).json({ code: error.code, msg: error.message });
        return;
    }
    logger_util_1.default.error("Social Studio request failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        operation,
        userId: req.userId,
    });
    res
        .status(500)
        .json({ msg: "The Social Studio request could not be completed." });
}
async function getStudio(req, res) {
    try {
        const studio = await (0, social_studio_service_1.getSocialStudio)(req.userId);
        res.json({ data: studio, msg: "Social Studio retrieved" });
    }
    catch (error) {
        sendSocialError(error, req, res, "get studio");
    }
}
async function startXOAuth(req, res) {
    try {
        const authorizationUrl = await (0, social_studio_service_1.beginXOAuth)({
            disclosureAccepted: req.body.disclosureAccepted,
            returnUrl: req.body.returnUrl,
            userId: req.userId,
        });
        res.json({ data: { authorizationUrl }, msg: "X authorization started" });
    }
    catch (error) {
        sendSocialError(error, req, res, "start X authorization");
    }
}
async function xOAuthCallback(req, res) {
    try {
        const callbackUrl = await (0, social_studio_service_1.completeXOAuth)({
            code: readQueryString(req.query.code),
            error: readQueryString(req.query.error),
            state: readQueryString(req.query.state),
        });
        res.setHeader("Cache-Control", "no-store");
        res.redirect(302, callbackUrl);
    }
    catch (error) {
        logger_util_1.default.error("X OAuth callback failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        res.redirect(302, "https://vybaa.app/app/social?xSocial=failed");
    }
}
function readQueryString(value) {
    return typeof value === "string" ? value : undefined;
}
function readRouteParam(value) {
    return Array.isArray(value) ? (value[0] ?? "") : value;
}
async function updatePreferences(req, res) {
    try {
        const timezone = await resolveTimezone(req, req.userId);
        const preferences = await (0, social_studio_service_1.updateSocialPreferences)({
            input: req.body,
            timezone,
            userId: req.userId,
        });
        res.json({ data: preferences, msg: "Social preferences updated" });
    }
    catch (error) {
        sendSocialError(error, req, res, "update preferences");
    }
}
async function updateActivityConsent(req, res) {
    try {
        const preferences = await (0, social_studio_service_1.updateSocialActivityConsent)({
            accepted: req.body.accepted,
            userId: req.userId,
        });
        res.json({ data: preferences, msg: "Social activity consent updated" });
    }
    catch (error) {
        sendSocialError(error, req, res, "update social activity consent");
    }
}
async function refreshSuggestions(req, res) {
    try {
        const result = await (0, social_studio_service_1.refreshSocialSuggestions)(req.userId, req.body.force);
        res.json({ data: result, msg: "Social suggestions refreshed" });
    }
    catch (error) {
        sendSocialError(error, req, res, "refresh social suggestions");
    }
}
async function resolveTimezone(req, userId) {
    const headerTimezone = req.headers["x-user-tz"];
    const candidate = typeof headerTimezone === "string" ? headerTimezone.trim() : "";
    if (candidate && luxon_1.DateTime.now().setZone(candidate).isValid) {
        return candidate;
    }
    const user = await db_config_1.prisma.user.findUnique({
        select: { timezone: true },
        where: { id: userId },
    });
    return user?.timezone && luxon_1.DateTime.now().setZone(user.timezone).isValid
        ? user.timezone
        : "UTC";
}
async function disconnectX(req, res) {
    try {
        await (0, social_studio_service_1.disconnectXAccount)(req.userId);
        res.json({ msg: "X account disconnected" });
    }
    catch (error) {
        sendSocialError(error, req, res, "disconnect X");
    }
}
async function syncMentions(req, res) {
    try {
        const syncedCount = await (0, social_studio_service_1.syncXMentions)(req.userId);
        res.json({ data: { syncedCount }, msg: "X mentions synced" });
    }
    catch (error) {
        sendSocialError(error, req, res, "sync mentions");
    }
}
async function generatePostDraft(req, res) {
    try {
        const draft = await (0, social_studio_service_1.generateSocialPostDraft)({
            brief: req.body.brief,
            type: req.body.type,
            userId: req.userId,
        });
        res.status(201).json({ data: draft, msg: "Social draft generated" });
    }
    catch (error) {
        sendSocialError(error, req, res, "generate post draft");
    }
}
async function generateReplyDraft(req, res) {
    try {
        const draft = await (0, social_studio_service_1.generateSocialReplyDraft)({
            mentionId: readRouteParam(req.params.mentionId),
            userId: req.userId,
        });
        res.status(201).json({ data: draft, msg: "Reply draft generated" });
    }
    catch (error) {
        sendSocialError(error, req, res, "generate reply draft");
    }
}
async function updateDraft(req, res) {
    try {
        const draft = await (0, social_studio_service_1.updateSocialDraft)({
            draftId: readRouteParam(req.params.draftId),
            segments: req.body.segments,
            userId: req.userId,
        });
        res.json({ data: draft, msg: "Social draft updated" });
    }
    catch (error) {
        sendSocialError(error, req, res, "update draft");
    }
}
async function discardDraft(req, res) {
    try {
        await (0, social_studio_service_1.discardSocialDraft)({
            draftId: readRouteParam(req.params.draftId),
            userId: req.userId,
        });
        res.json({ msg: "Social draft removed" });
    }
    catch (error) {
        sendSocialError(error, req, res, "discard draft");
    }
}
async function publishDraft(req, res) {
    try {
        const draft = await (0, social_studio_service_1.publishSocialDraft)({
            draftId: readRouteParam(req.params.draftId),
            userId: req.userId,
        });
        res.json({ data: draft, msg: "Draft published to X" });
    }
    catch (error) {
        sendSocialError(error, req, res, "publish draft");
    }
}
