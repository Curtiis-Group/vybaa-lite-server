"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClientAppFromPath = getClientAppFromPath;
exports.setClientApp = setClientApp;
exports.clientAppMiddleware = clientAppMiddleware;
const MYCOVE_PATH_PREFIX = "/mycove";
function getClientAppFromPath(path) {
    return path === MYCOVE_PATH_PREFIX ||
        path.startsWith(`${MYCOVE_PATH_PREFIX}/`)
        ? "mycove"
        : "vybaa";
}
function setClientApp(req, clientApp) {
    req.clientApp = clientApp;
}
function clientAppMiddleware(req, _res, next) {
    setClientApp(req, getClientAppFromPath(req.path));
    next();
}
