"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.containsObjectionableContent = containsObjectionableContent;
exports.isAllowedUserContent = isAllowedUserContent;
const OBJECTIONABLE_TERMS = [
    /\b(?:kys|kill yourself|murder)\b/i,
    /\b(?:rape|rapist|sexual assault)\b/i,
    /\b(?:child porn|csam|underage sex)\b/i,
    /\b(?:nazi|terrorist)\b/i,
    /\b(?:n[i1!]gg(?:er|a)|f[a@]gg[o0]t|ch[i1!]nk)\b/i,
    /\b(?:send nudes|revenge porn)\b/i,
    /\b(?:i will (?:find|hurt|kill) you)\b/i,
];
function containsObjectionableContent(value) {
    const normalized = value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/@/g, "a")
        .replace(/[!1|]/g, "i")
        .replace(/0/g, "o")
        .replace(/\$/g, "s")
        .replace(/[\u0000-\u001f]/g, " ")
        .replace(/([a-z])[^a-z0-9\s]+(?=[a-z])/gi, "$1")
        .replace(/\s+/g, " ")
        .trim();
    return OBJECTIONABLE_TERMS.some((term) => term.test(normalized));
}
function isAllowedUserContent(value) {
    return !containsObjectionableContent(value);
}
