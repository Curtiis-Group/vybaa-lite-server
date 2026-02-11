"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.firebaseClient = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const env_util_1 = require("../utils/env.util");
let firebaseApp = null;
const firebaseClient = () => {
    if (!firebaseApp) {
        const projectId = env_util_1.Env.FIREBASE_PROJECT_ID || "streekapp-1";
        const privateKey = env_util_1.Env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
        const clientEmail = env_util_1.Env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-1dtb8@streekapp-1.iam.gserviceaccount.com";
        if (!privateKey) {
            throw new Error("FIREBASE_PRIVATE_KEY is not configured");
        }
        firebaseApp = firebase_admin_1.default.initializeApp({
            credential: firebase_admin_1.default.credential.cert({
                projectId,
                privateKey,
                clientEmail,
            }),
        }, `firebase-${Date.now()}`);
    }
    return firebaseApp;
};
exports.firebaseClient = firebaseClient;
