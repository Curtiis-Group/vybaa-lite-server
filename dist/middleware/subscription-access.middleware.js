"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRewindChatProAccess = requireRewindChatProAccess;
const subscription_access_service_1 = require("../services/subscription-access.service");
async function requireRewindChatProAccess(req, res, next) {
    try {
        await (0, subscription_access_service_1.assertCanUseRewindChats)(req.userId, req.clientApp);
        next();
    }
    catch (error) {
        if ((0, subscription_access_service_1.handleSubscriptionAccessError)(error, res))
            return;
        next(error);
    }
}
