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
exports.AuthEmailLayout = AuthEmailLayout;
const jsx_runtime_1 = require("react/jsx-runtime");
const React = __importStar(require("react"));
const components_1 = require("@react-email/components");
function AuthEmailLayout({ previewText, heading, children, }) {
    return ((0, jsx_runtime_1.jsxs)(components_1.Html, { children: [(0, jsx_runtime_1.jsx)(components_1.Head, {}), (0, jsx_runtime_1.jsx)(components_1.Preview, { children: previewText }), (0, jsx_runtime_1.jsx)(components_1.Body, { style: body, children: (0, jsx_runtime_1.jsxs)(components_1.Container, { style: container, children: [(0, jsx_runtime_1.jsx)(components_1.Section, { style: header, children: (0, jsx_runtime_1.jsx)(components_1.Text, { style: brand, children: "Vybaa" }) }), (0, jsx_runtime_1.jsx)(components_1.Section, { children: (0, jsx_runtime_1.jsx)(components_1.Text, { style: title, children: heading }) }), (0, jsx_runtime_1.jsx)(components_1.Section, { children: children }), (0, jsx_runtime_1.jsxs)(components_1.Section, { style: footer, children: [(0, jsx_runtime_1.jsx)(components_1.Text, { style: footerText, children: "You\u2019re receiving this email because you have a Vybaa account." }), (0, jsx_runtime_1.jsxs)(components_1.Text, { style: footerText, children: ["\u00A9 ", new Date().getFullYear(), " Vybaa"] })] })] }) })] }));
}
const body = {
    backgroundColor: "#020617",
    margin: 0,
    padding: "24px 0",
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
};
const container = {
    backgroundColor: "#020617",
    color: "#f9fafb",
    padding: "32px 24px",
    borderRadius: 24,
    border: "1px solid rgba(148,163,184,0.35)",
    maxWidth: "480px",
};
const header = {
    marginBottom: 12,
};
const brand = {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 1,
};
const title = {
    fontSize: 22,
    fontWeight: 700,
    margin: "8px 0 16px",
};
const footer = {
    marginTop: 24,
    borderTop: "1px solid rgba(148,163,184,0.25)",
    paddingTop: 12,
};
const footerText = {
    fontSize: 12,
    color: "#9ca3af",
};
