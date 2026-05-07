"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmationEmail = ConfirmationEmail;
const jsx_runtime_1 = require("react/jsx-runtime");
const React = __importStar(require("react"));
const AuthLayout_1 = require("./AuthLayout");
const components_1 = require("@react-email/components");
function ConfirmationEmail({ name, code }) {
    return ((0, jsx_runtime_1.jsxs)(AuthLayout_1.AuthEmailLayout, { previewText: "Confirm your Vybaa account with this code.", heading: "Confirm your email", children: [(0, jsx_runtime_1.jsxs)(components_1.Text, { style: paragraph, children: ["Welcome, ", name, "!"] }), (0, jsx_runtime_1.jsx)(components_1.Text, { style: paragraph, children: "Thanks for joining Vybaa. Use this code to confirm your email address and finish setting up your account. It expires in 10 minutes." }), (0, jsx_runtime_1.jsx)(components_1.Text, { style: codeBlock, children: code }), (0, jsx_runtime_1.jsx)(components_1.Text, { style: paragraph, children: "If you didn\u2019t create a Vybaa account, you can ignore this email." })] }));
}
const paragraph = {
    fontSize: 14,
    lineHeight: 1.6,
    margin: "4px 0 8px",
};
const codeBlock = {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 8,
    textAlign: "center",
    padding: "12px 16px",
    borderRadius: 999,
    background: "linear-gradient(135deg, rgba(248,250,252,0.12), rgba(248,250,252,0.04))",
    border: "1px solid rgba(148,163,184,0.45)",
    margin: "16px 0 8px",
};
