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
exports.ModerationAlertEmail = ModerationAlertEmail;
const jsx_runtime_1 = require("react/jsx-runtime");
const components_1 = require("@react-email/components");
const React = __importStar(require("react"));
const AuthLayout_1 = require("./AuthLayout");
function ModerationAlertEmail({ reason, reportId, responseDueAt, targetType, }) {
    return ((0, jsx_runtime_1.jsxs)(AuthLayout_1.AuthEmailLayout, { heading: "Content report needs review", previewText: "A Vybaa safety report needs action within 24 hours.", children: [(0, jsx_runtime_1.jsxs)(components_1.Text, { style: paragraph, children: ["Report: ", reportId] }), (0, jsx_runtime_1.jsxs)(components_1.Text, { style: paragraph, children: ["Target: ", targetType] }), (0, jsx_runtime_1.jsxs)(components_1.Text, { style: paragraph, children: ["Reason: ", reason] }), (0, jsx_runtime_1.jsxs)(components_1.Text, { style: paragraph, children: ["Review deadline: ", responseDueAt] }), (0, jsx_runtime_1.jsx)(components_1.Text, { style: warning, children: "Review the evidence, remove violating content, and suspend the offending account when required by the community standards." })] }));
}
const paragraph = {
    fontSize: 14,
    lineHeight: 1.6,
    margin: "4px 0 8px",
};
const warning = {
    backgroundColor: "#422006",
    borderRadius: 12,
    color: "#fef3c7",
    fontSize: 14,
    lineHeight: 1.6,
    marginTop: 16,
    padding: 16,
};
