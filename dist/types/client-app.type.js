"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_APPS = void 0;
exports.isClientApp = isClientApp;
exports.toPrismaClientApp = toPrismaClientApp;
exports.fromPrismaClientApp = fromPrismaClientApp;
exports.CLIENT_APPS = ["vybaa", "mycove"];
function isClientApp(value) {
    return typeof value === "string" && exports.CLIENT_APPS.includes(value);
}
function toPrismaClientApp(clientApp) {
    return clientApp === "mycove" ? "MYCOVE" : "VYBAA";
}
function fromPrismaClientApp(clientApp) {
    return clientApp === "MYCOVE" ? "mycove" : "vybaa";
}
