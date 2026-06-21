# FIT College Career Advisor — Relay

A small Express server that powers the FIT College website chat widget. It:

- proxies chat turns to the Anthropic Messages API using an editable system
  prompt + knowledge base,
- personalises the greeting by resolving the visitor's first name from HubSpot
  (via the `hubspotutk` cookie),
- summarises finished conversations and writes structured fields + a timeline
  note back to the HubSpot contact.

Behaviour lives in `prompt/system-prompt.md`; **all course facts live in
`knowledge-base/kb.md`** (the single source of truth). Keep the two separate.

## Layout

```
relay/
├── server.js                     # the relay
├── prompt/
│   ├── system-prompt.md          # advisor behaviour (template with slots)
│   └── summariser-prompt.md      # extracts CRM fields from a transcript
└── knowledge-base/
    └── kb.md                     # course facts, fees, FAQ, RPL, refunds
```

`server.js` reads these paths relative to its own directory, so run it from
inside `relay/`.

## Requirements

- Node.js 18+ (uses the global `fetch`).

## Setup

```bash
cd relay
npm install
cp .env.example .env   # then fill in the values below
npm start              # or: npm run dev  (auto-restart on change)
```

The server refuses to start without `ANTHROPIC_API_KEY`.

## Environment variables

| Variable             | Required | Default                            | Purpose                                                        |
| -------------------- | -------- | ---------------------------------- | -------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | yes      | —                                  | Anthropic API key. Server exits if missing.                    |
| `HUBSPOT_TOKEN`      | no       | —                                  | Private-app token for name resolution + write-back. Fails safe if unset. |
| `ADMIN_RELOAD_TOKEN` | no       | —                                  | Shared secret for `POST /admin/reload-kb`.                     |
| `ALLOWED_ORIGIN`     | no       | `https://www.fitcollege.edu.au`    | CORS origin allowed to call the relay.                         |
| `CHAT_MODEL`         | no       | `claude-haiku-4-5-20251001`        | Model for chat replies.                                        |
| `SUMMARY_MODEL`      | no       | `claude-haiku-4-5-20251001`        | Model for the conversation summariser.                         |
| `PORT`               | no       | `3000`                             | Port to listen on.                                             |

## Endpoints

### `GET /health`
Liveness check. Returns `{ "ok": true }`.

### `POST /chat`
Generate an advisor reply.

Request:
```json
{ "utk": "<hubspotutk cookie, optional>",
  "messages": [{ "role": "user", "content": "Hi" }] }
```
Response:
```json
{ "reply": "…", "offerBooking": false }
```
`offerBooking` is `true` when the model emits the `[[OFFER_BOOKING]]` control
token (stripped from `reply`); the widget then shows the booking UI. Rate
limited to 30 requests/minute per IP. Conversations are capped at 40 turns and
4000 chars/message.

### `POST /summarise`
Fire-and-forget. Acks `202` immediately, then asynchronously summarises the
transcript and syncs structured fields + a timeline note to the HubSpot
contact. No-op if the visitor can't be resolved or HubSpot is unconfigured.

### `POST /admin/reload-kb`
Reload `knowledge-base/kb.md` from disk without restarting (e.g. after editing
the KB). Requires header `x-admin-token: <ADMIN_RELOAD_TOKEN>`; returns `403`
otherwise.

```bash
curl -X POST http://localhost:3000/admin/reload-kb \
  -H "x-admin-token: $ADMIN_RELOAD_TOKEN"
```

## Editing the knowledge base

`kb.md` is the single source of truth for every course fact (prices, durations,
entry requirements, RPL, refunds, FAQ). After editing it, either restart the
server or call `POST /admin/reload-kb`. Never hardcode course facts in
`server.js` or the prompts.
