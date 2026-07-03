"use strict";

const http = require("http");
const { WebSocketServer } = require("ws");
const config = require("./config");
const logger = require("./logger");
const db = require("./db");
const { CallStream } = require("./exotel/streamHandler");

function clientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
    return req.socket.remoteAddress || "";
}

function ipAllowed(ip) {
    if (config.security.allowedIps.length === 0) return true;
    const normalized = ip.replace(/^::ffff:/, "");
    return config.security.allowedIps.some((allowed) => normalized === allowed);
}

function basicAuthOk(req) {
    if (!config.security.basicAuthUser) return true;
    const header = req.headers.authorization || "";
    if (!header.startsWith("Basic ")) return false;
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const [user, pass] = decoded.split(":");
    return user === config.security.basicAuthUser && pass === config.security.basicAuthPass;
}

// ---------------------------------------------------------------------------
// HTTP server: health check + dynamic wss resolver (Exotel can POST/GET an
// https URL that returns { "url": "wss://..." }).
// ---------------------------------------------------------------------------
const httpServer = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
            JSON.stringify({
                status: "ok",
                service: "voice-stream-server",
                enabled: config.enabled,
                db: db.isConnected(),
                wsPath: config.wsPath,
            }),
        );
    }

    if (req.url.startsWith("/resolve")) {
        // Dynamic endpoint: return the wss URL for the Voicebot applet.
        const host = req.headers.host;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
            JSON.stringify({
                url: `wss://${host}${config.wsPath}?sample-rate=${config.audio.sampleRate}`,
            }),
        );
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
});

// ---------------------------------------------------------------------------
// WebSocket server (Exotel Voicebot bidirectional stream)
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== config.wsPath) {
        socket.destroy();
        return;
    }

    if (!config.enabled) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
    }

    const ip = clientIp(req);
    if (!ipAllowed(ip)) {
        logger.warn(`rejected WS from disallowed ip=${ip}`);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
    }

    if (!basicAuthOk(req)) {
        logger.warn(`rejected WS with bad basic auth ip=${ip}`);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
    });
});

wss.on("connection", (ws, req) => {
    const ip = clientIp(req);
    logger.info(`WS connection from ip=${ip}`);
    const call = new CallStream(ws, { ip });

    ws.on("message", (data) => {
        call.handleMessage(data).catch((err) => logger.error("handleMessage error:", err.message));
    });

    ws.on("close", (code) => {
        logger.info(`WS closed code=${code}`);
        call.endCall("ws_closed").catch(() => {});
    });

    ws.on("error", (err) => {
        logger.error("WS error:", err.message);
    });
});

async function main() {
    await db.connectDb().catch((err) => logger.error("DB connect failed:", err.message));
    httpServer.listen(config.port, () => {
        logger.info(`voice-stream-server listening on :${config.port} path=${config.wsPath}`);
        logger.info(`sample rate=${config.audio.sampleRate} model=${config.gemini.model}`);
    });
}

process.on("unhandledRejection", (err) => logger.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => logger.error("uncaughtException:", err));

main();
