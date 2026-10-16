"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XApiError = void 0;
exports.isXSocialConfigured = isXSocialConfigured;
exports.getXClientConfiguration = getXClientConfiguration;
exports.createXAuthorizeUrl = createXAuthorizeUrl;
exports.exchangeXAuthorizationCode = exchangeXAuthorizationCode;
exports.refreshXAccessToken = refreshXAccessToken;
exports.getXAuthenticatedProfile = getXAuthenticatedProfile;
exports.getXRecentOriginalPosts = getXRecentOriginalPosts;
exports.getXMentions = getXMentions;
exports.createXPost = createXPost;
const env_util_1 = require("../utils/env.util");
const x_social_crypto_util_1 = require("../utils/x-social-crypto.util");
const X_API_BASE_URL = "https://api.x.com";
const X_TOKEN_URL = X_API_BASE_URL + "/2/oauth2/token";
const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const REQUEST_TIMEOUT_MS = 20000;
class XApiError extends Error {
    constructor(diagnostics) {
        super("X could not complete the request");
        this.name = "XApiError";
        this.causeName = diagnostics.causeName;
        this.durationMs = diagnostics.durationMs;
        this.failureKind = diagnostics.failureKind;
        this.operation = diagnostics.operation;
        this.providerErrorCode = diagnostics.providerErrorCode;
        this.providerErrorDetail = diagnostics.providerErrorDetail;
        this.providerErrorTitle = diagnostics.providerErrorTitle;
        this.providerErrorType = diagnostics.providerErrorType;
        this.providerRequestId = diagnostics.providerRequestId;
        this.rateLimitRemaining = diagnostics.rateLimitRemaining;
        this.rateLimitReset = diagnostics.rateLimitReset;
        this.status = diagnostics.status;
    }
}
exports.XApiError = XApiError;
function isXSocialConfigured() {
    return (env_util_1.Env.X_SOCIAL_ENABLED === "true" &&
        Boolean(env_util_1.Env.X_CLIENT_ID?.trim()) &&
        Boolean(env_util_1.Env.X_REDIRECT_URI?.trim()) &&
        (0, x_social_crypto_util_1.isSocialEncryptionConfigured)());
}
function getXClientConfiguration() {
    if (!isXSocialConfigured()) {
        throw new Error("X social studio is not configured");
    }
    return {
        clientId: env_util_1.Env.X_CLIENT_ID.trim(),
        clientSecret: env_util_1.Env.X_CLIENT_SECRET?.trim() || null,
        redirectUri: env_util_1.Env.X_REDIRECT_URI.trim(),
    };
}
function createXAuthorizeUrl(params) {
    const config = getXClientConfiguration();
    const url = new URL(X_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("scope", "tweet.read tweet.write users.read offline.access");
    url.searchParams.set("state", params.state);
    url.searchParams.set("code_challenge", params.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
}
async function exchangeXAuthorizationCode(code, codeVerifier) {
    const config = getXClientConfiguration();
    const body = new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
    });
    const headers = new Headers({
        "Content-Type": "application/x-www-form-urlencoded",
    });
    addClientAuthentication(headers, body, config.clientId, config.clientSecret);
    const startedAt = Date.now();
    const payload = await readJson(await fetchX(X_TOKEN_URL, {
        body,
        headers,
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, "oauth_token_exchange"), "oauth_token_exchange", startedAt);
    return parseTokenResponse(payload, "oauth_token_exchange");
}
async function refreshXAccessToken(refreshToken) {
    const config = getXClientConfiguration();
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });
    const headers = new Headers({
        "Content-Type": "application/x-www-form-urlencoded",
    });
    addClientAuthentication(headers, body, config.clientId, config.clientSecret);
    const startedAt = Date.now();
    const payload = await readJson(await fetchX(X_TOKEN_URL, {
        body,
        headers,
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, "oauth_token_refresh"), "oauth_token_refresh", startedAt);
    return parseTokenResponse(payload, "oauth_token_refresh");
}
function addClientAuthentication(headers, body, clientId, clientSecret) {
    if (clientSecret) {
        headers.set("Authorization", "Basic " +
            Buffer.from(clientId + ":" + clientSecret, "utf8").toString("base64"));
    }
    else {
        body.set("client_id", clientId);
    }
}
function parseTokenResponse(value, operation) {
    if (!isRecord(value) || typeof value.access_token !== "string") {
        throw createInvalidPayloadError(operation, "missing_access_token");
    }
    const expiresIn = typeof value.expires_in === "number" && Number.isFinite(value.expires_in)
        ? Math.max(0, value.expires_in)
        : null;
    const scopeValue = typeof value.scope === "string" ? value.scope : "";
    return {
        accessToken: value.access_token,
        expiresAt: expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000),
        refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : null,
        scopes: scopeValue.split(/\s+/).filter(Boolean),
    };
}
async function getXAuthenticatedProfile(accessToken) {
    const url = new URL(X_API_BASE_URL + "/2/users/me");
    url.searchParams.set("user.fields", "name,username,profile_image_url");
    const payload = await requestXJson(url, accessToken, {}, "users_me");
    const data = isRecord(payload) ? payload.data : null;
    if (!isRecord(data) ||
        typeof data.id !== "string" ||
        typeof data.username !== "string") {
        throw createInvalidPayloadError("users_me", "missing_authenticated_profile");
    }
    return {
        displayName: typeof data.name === "string" ? data.name : data.username,
        id: data.id,
        profileImageUrl: typeof data.profile_image_url === "string"
            ? data.profile_image_url
            : null,
        username: data.username,
    };
}
async function getXRecentOriginalPosts(accessToken, userId) {
    const url = new URL(X_API_BASE_URL + "/2/users/" + encodeURIComponent(userId) + "/tweets");
    url.searchParams.set("max_results", "10");
    url.searchParams.set("exclude", "retweets,replies");
    url.searchParams.set("tweet.fields", "created_at");
    const payload = await requestXJson(url, accessToken, {}, "user_timeline");
    const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    return data
        .filter((post) => isRecord(post) && typeof post.text === "string")
        .map((post) => post.text)
        .filter((post) => post.trim().length > 0)
        .slice(0, 10);
}
async function getXMentions(params) {
    const url = new URL(X_API_BASE_URL +
        "/2/users/" +
        encodeURIComponent(params.userId) +
        "/mentions");
    url.searchParams.set("max_results", "100");
    url.searchParams.set("tweet.fields", "author_id,created_at,referenced_tweets");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "name,username");
    if (params.sinceId)
        url.searchParams.set("since_id", params.sinceId);
    const payload = await requestXJson(url, params.accessToken, {}, "user_mentions");
    const record = isRecord(payload) ? payload : {};
    const rawPosts = Array.isArray(record.data) ? record.data : [];
    const includes = isRecord(record.includes) ? record.includes : {};
    const rawUsers = Array.isArray(includes.users) ? includes.users : [];
    const usersById = new Map();
    for (const user of rawUsers) {
        if (!isRecord(user) || typeof user.id !== "string")
            continue;
        if (typeof user.username !== "string")
            continue;
        usersById.set(user.id, {
            name: typeof user.name === "string" ? user.name : null,
            username: user.username,
        });
    }
    const posts = rawPosts.flatMap((rawPost) => {
        if (!isRecord(rawPost) ||
            typeof rawPost.id !== "string" ||
            typeof rawPost.text !== "string") {
            return [];
        }
        const authorId = typeof rawPost.author_id === "string" ? rawPost.author_id : null;
        const author = authorId ? usersById.get(authorId) : undefined;
        const referencedTweets = Array.isArray(rawPost.referenced_tweets)
            ? rawPost.referenced_tweets
            : [];
        const referencedTweetIds = referencedTweets.flatMap((reference) => isRecord(reference) && typeof reference.id === "string"
            ? [reference.id]
            : []);
        const createdAt = typeof rawPost.created_at === "string"
            ? new Date(rawPost.created_at)
            : new Date();
        return [
            {
                authorDisplayName: author?.name ?? null,
                authorId,
                authorUsername: author?.username ?? "unknown",
                createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
                id: rawPost.id,
                referencedTweetIds,
                text: rawPost.text,
            },
        ];
    });
    const latestId = posts.reduce((latest, post) => {
        if (!latest)
            return post.id;
        try {
            return BigInt(post.id) > BigInt(latest) ? post.id : latest;
        }
        catch {
            return post.id > latest ? post.id : latest;
        }
    }, null);
    return { latestId, posts };
}
async function createXPost(params) {
    const body = { text: params.text };
    if (params.replyToTweetId) {
        body.reply = { in_reply_to_tweet_id: params.replyToTweetId };
    }
    const payload = await requestXJson(new URL(X_API_BASE_URL + "/2/tweets"), params.accessToken, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
    }, "create_tweet");
    const data = isRecord(payload) ? payload.data : null;
    if (!isRecord(data) || typeof data.id !== "string") {
        throw createInvalidPayloadError("create_tweet", "missing_created_post");
    }
    return data.id;
}
async function requestXJson(url, accessToken, init = {}, operation) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer " + accessToken);
    headers.set("Accept", "application/json");
    const startedAt = Date.now();
    return readJson(await fetchX(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, operation), operation, startedAt);
}
async function fetchX(url, init, operation) {
    const startedAt = Date.now();
    try {
        return await fetch(url, init);
    }
    catch (error) {
        const causeName = error instanceof Error ? error.name : "UnknownError";
        throw new XApiError({
            causeName,
            durationMs: Date.now() - startedAt,
            failureKind: causeName === "AbortError" || causeName === "TimeoutError"
                ? "timeout"
                : "network",
            operation,
            providerErrorCode: null,
            providerErrorDetail: null,
            providerErrorTitle: null,
            providerErrorType: null,
            providerRequestId: null,
            rateLimitRemaining: null,
            rateLimitReset: null,
            status: 0,
        });
    }
}
async function readJson(response, operation, startedAt) {
    const rawBody = await response.text().catch(() => "");
    const payload = parseJson(rawBody);
    if (!response.ok) {
        const providerError = summarizeProviderError(payload);
        throw new XApiError({
            causeName: null,
            durationMs: Date.now() - startedAt,
            failureKind: "http",
            operation,
            providerErrorCode: providerError.code,
            providerErrorDetail: providerError.detail,
            providerErrorTitle: providerError.title,
            providerErrorType: providerError.type,
            providerRequestId: readHeader(response, ["x-request-id", "x-response-id"]),
            rateLimitRemaining: readHeader(response, ["x-rate-limit-remaining"]),
            rateLimitReset: readHeader(response, ["x-rate-limit-reset"]),
            status: response.status,
        });
    }
    return payload;
}
function createInvalidPayloadError(operation, providerErrorCode) {
    return new XApiError({
        causeName: null,
        durationMs: 0,
        failureKind: "invalid_payload",
        operation,
        providerErrorCode,
        providerErrorDetail: null,
        providerErrorTitle: null,
        providerErrorType: null,
        providerRequestId: null,
        rateLimitRemaining: null,
        rateLimitReset: null,
        status: 502,
    });
}
function parseJson(rawBody) {
    if (!rawBody.trim())
        return null;
    try {
        const parsed = JSON.parse(rawBody);
        return parsed;
    }
    catch {
        return null;
    }
}
function summarizeProviderError(value) {
    const record = isRecord(value) ? value : null;
    const firstNestedError = record && Array.isArray(record.errors)
        ? record.errors.find(isRecord)
        : null;
    const source = firstNestedError ?? record;
    if (!source) {
        return { code: null, detail: null, title: null, type: null };
    }
    return {
        code: firstString(source, ["error", "code"]) ?? null,
        detail: sanitizeDiagnosticText(firstString(source, ["error_description", "detail"]) ?? ""),
        title: sanitizeDiagnosticText(firstString(source, ["title"]) ?? ""),
        type: sanitizeDiagnosticText(firstString(source, ["type"]) ?? ""),
    };
}
function firstString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return undefined;
}
function sanitizeDiagnosticText(value) {
    if (!value)
        return null;
    const sanitized = value
        .replace(/\b(access[_ -]?token|refresh[_ -]?token|client[_ -]?id|client[_ -]?secret|code|code[_ -]?verifier|redirect[_ -]?uri|authorization|bearer)\b\s*[:=]\s*[^,;\s]+/gi, "$1=[REDACTED]")
        .trim();
    return sanitized ? sanitized.slice(0, 240) : null;
}
function readHeader(response, names) {
    for (const name of names) {
        const value = response.headers.get(name)?.trim();
        if (value)
            return value.slice(0, 160);
    }
    return null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
