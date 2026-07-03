# Doorstep Hub — Voice Stream Server

Standalone Node service that powers **real-time AI phone conversations** for Phase 3 Module 2.

It implements Exotel's **Voicebot Applet (bidirectional WebSocket)** protocol and runs the pipeline:

```
Caller ⇄ Exotel ⇄ (wss) voice-stream-server
                        ├─ Google Cloud Speech-to-Text (streaming)
                        ├─ Gemini (@google/genai)
                        └─ Google Cloud Text-to-Speech
                     logs → same MongoDB as the main API (admin panel)
```

## Why a separate server?

The main API runs on cPanel/Passenger, which cannot hold long-lived WebSockets reliably.
This service runs on a small dedicated VM (DigitalOcean / Lightsail / EC2) at
`wss://voice.doorstephub.com/stream`. The cPanel API only *triggers* the call; Exotel then
streams audio straight to this VM.

## Prerequisites

1. **A VM** with a public IP, Node 18+, Nginx.
2. **DNS**: `voice.doorstephub.com` → VM IP.
3. **TLS cert** for the subdomain (Let's Encrypt via certbot).
4. **Google Cloud service account** (project `970716539757`) with **Speech-to-Text** and
   **Text-to-Speech** APIs enabled. Download the JSON key → `gcp-service-account.json`.
   (API keys do NOT work for gRPC streaming STT — a service account is required.)
5. **Exotel** must enable the **Voicebot Applet / streaming** for SID `goexperts2`
   (email hello@exotel.com) and give you their **IP ranges** for whitelisting.

## Install

```bash
git clone <repo> && cd voice-stream-server
npm install
cp .env.example .env      # fill in values
# put gcp-service-account.json in the project root
```

## Run

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

Health check:

```bash
curl http://localhost:5014/health
```

## Nginx reverse proxy (TLS + WebSocket upgrade)

`/etc/nginx/sites-available/voice.doorstephub.com`:

```nginx
server {
    listen 443 ssl;
    server_name voice.doorstephub.com;

    ssl_certificate     /etc/letsencrypt/live/voice.doorstephub.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voice.doorstephub.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5014;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 3600s;   # keep the call socket alive
        proxy_send_timeout 3600s;
    }
}
```

```bash
sudo certbot --nginx -d voice.doorstephub.com
sudo nginx -t && sudo systemctl reload nginx
```

## Connect it to the main API

In the cPanel backend `.env`:

```env
AI_VOICE_ENABLED=true
AI_VOICE_STREAM_MODE=true
VOICE_STREAM_URL=wss://voice.doorstephub.com/stream?sample-rate=16000
```

Now `POST /v1/dhubApi/admin/ai-voice/calls/trigger` dials the customer and connects the
answered call to this server. Sessions/messages appear in the admin panel because both
services share `MONGO_URI`.

## Test

```bash
# 1. Local echo of protocol (no phone): check /health returns ok
curl https://voice.doorstephub.com/health

# 2. Trigger a real call from the main API (admin JWT)
POST /v1/dhubApi/admin/ai-voice/calls/trigger
{ "mobile": "9515362625", "callPurpose": "manual_test", "language": "en" }
```

Your phone rings, the AI greets you, you talk, it responds. Transcript is saved to the
session and viewable at `GET /v1/dhubApi/admin/ai-voice/sessions/:id`.

## Environment variables

See `.env.example`. Key ones:

| Var | Purpose |
|-----|---------|
| `MONGO_URI` | **Same DB** as the main backend |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account JSON |
| `AI_API_KEY` | Gemini AI Studio `AQ.` key |
| `AUDIO_SAMPLE_RATE` | Must match `?sample-rate=` on the stream URL (16000) |
| `ALLOWED_IPS` | Exotel IP whitelist (get from Exotel support) |

## Security

- Whitelist Exotel IPs via `ALLOWED_IPS` (or Basic auth) — the WS endpoint is public.
- Never commit `.env` or `gcp-service-account.json`.
