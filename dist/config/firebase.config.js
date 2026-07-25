"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.firebaseClient = firebaseClient;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const env_util_1 = require("../utils/env.util");
const firebaseApps = new Map();
function getFirebaseCredentials(clientApp) {
    if (clientApp === "mycove") {
        return {
            clientEmail: env_util_1.Env.MYCOVE_FIREBASE_CLIENT_EMAIL,
            privateKey: env_util_1.Env.MYCOVE_FIREBASE_PRIVATE_KEY,
            projectId: env_util_1.Env.MYCOVE_FIREBASE_PROJECT_ID,
        };
    }
    return {
        clientEmail: env_util_1.Env.FIREBASE_CLIENT_EMAIL,
        privateKey: env_util_1.Env.FIREBASE_PRIVATE_KEY,
        projectId: env_util_1.Env.FIREBASE_PROJECT_ID,
    };
}
function requireFirebaseCredentials(clientApp) {
    const credentials = getFirebaseCredentials(clientApp);
    const prefix = clientApp === "mycove" ? "MYCOVE_" : "";
    if (!credentials.projectId?.trim()) {
        throw new Error(`${prefix}FIREBASE_PROJECT_ID is not configured`);
    }
    if (!credentials.privateKey?.trim()) {
        throw new Error(`${prefix}FIREBASE_PRIVATE_KEY is not configured`);
    }
    if (!credentials.clientEmail?.trim()) {
        throw new Error(`${prefix}FIREBASE_CLIENT_EMAIL is not configured`);
    }
    return {
        clientEmail: credentials.clientEmail,
        privateKey: credentials.privateKey.replace(/\\n/g, "\n"),
        projectId: credentials.projectId,
    };
}
function firebaseClient(clientApp = "vybaa") {
    const existingApp = firebaseApps.get(clientApp);
    if (existingApp)
        return existingApp;
    const credentials = requireFirebaseCredentials(clientApp);
    const app = firebase_admin_1.default.initializeApp({ credential: firebase_admin_1.default.credential.cert(credentials) }, `firebase-${clientApp}`);
    firebaseApps.set(clientApp, app);
    return app;
}
