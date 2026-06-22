# FIT College Career Advisor — Chat Bot

A lightweight chat advisor for the FIT College website. A single embeddable
widget talks to a small Node relay, which calls Claude for replies and (when a
chat ends) summarises the conversation into HubSpot.

```
widget.js  ──HTTPS──▶  server.js (relay)  ──▶  Anthropic API (chat + summary)
(browser)                                 ──▶  HubSpot (name lookup + write-back)
```

## Repository layout

| Path | What |
| --- | --- |
| `server.js` | The relay server (Express). Endpoints: `/chat`, `/summarise`, `/health`, `/admin/reload-kb`. |
| `widget.js` | The embeddable front-end widget (no build step). |
| `prompt/system-prompt.md` | Advisor system prompt. `{{FIRST_NAME}}` + `{{KNOWLEDGE_BASE}}` are filled in at runtime. |
| `prompt/summariser-prompt.md` | Post-chat summariser prompt (returns JSON mapped to HubSpot). |
| `knowledge-base/kb.md` | The advisor's knowledge base, injected into the system prompt. |
| `relay/` | One-off HubSpot setup scripts (see `relay/README.md`). |

## Prerequisites

- Node.js 18+ (the relay uses global `fetch`).
- An Anthropic API key.
- (Optional) A HubSpot private-app token with CRM scopes for name lookup and
  write-back, plus the six `fitc_*` contact properties created by
  `relay/` (see `relay/README.md`).

## Run the relay locally

```bash
npm install
cp .env.example .env       # then fill in ANTHROPIC_API_KEY (required)
npm start                  # or: npm run dev  (auto-restart on change)
```

The server refuses to start without `ANTHROPIC_API_KEY`. Once up:

```bash
curl http://localhost:3000/health      # -> {"ok":true}
```

See `.env.example` for all configuration (`ALLOWED_ORIGIN`, `HUBSPOT_TOKEN`,
`ADMIN_RELOAD_TOKEN`, `CHAT_MODEL`, `SUMMARY_MODEL`, `PORT`).

## Deploy

The relay is a standard Node web service — host it anywhere that runs Node 18+
(Render, Railway, Fly.io, a VM, etc.). The platform needs to:

1. Run `npm install` then `npm start`.
2. Provide the environment variables from `.env.example` as secrets.
3. Expose HTTPS publicly.

Set `ALLOWED_ORIGIN` to the exact origin of the site the widget is embedded on
(e.g. `https://www.fitcollege.edu.au`) so CORS allows the browser calls.

## Embed the widget

Host `widget.js` on a public URL (CDN or the relay host) and drop one tag on the
page just before `</body>` (not `async`/`defer`):

```html
<script src="https://YOUR-HOST/widget.js"
        data-relay="https://your-relay.example.com"
        data-meeting="https://meetings.hubspot.com/your-rep"></script>
```

Optional `data-*` attributes:

| Attribute | Purpose |
| --- | --- |
| `data-firstname="Sam"` | Personalise the greeting (or pass `?fn=Sam` on the redirect). |
| `data-autoopen="1500"` | Milliseconds before the panel auto-opens once (default 1500; `0` = never). |
| `data-demo="true"` | Preview the UI with canned replies — no relay needed. |

With no `data-relay` set, the widget runs in demo mode.

## Updating the knowledge base

Edit `knowledge-base/kb.md` and restart the relay, or — if `ADMIN_RELOAD_TOKEN`
is configured — reload without a restart:

```bash
curl -X POST https://your-relay.example.com/admin/reload-kb \
  -H "x-admin-token: $ADMIN_RELOAD_TOKEN"
```
