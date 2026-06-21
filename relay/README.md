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

## HubSpot setup

The relay personalises the greeting from a contact (via the `hubspotutk`
cookie) and, after each chat, writes structured `fitc_*` properties plus a
timeline note back to that contact.

### 1. Create a private app

In HubSpot → Settings → Integrations → Private Apps, create an app and grant
these scopes (the notes scope is easy to miss):

- `crm.objects.contacts.read`
- `crm.objects.contacts.write` — also authorises creating/associating the
  timeline **note** (notes are engagements; the Notes API uses the Contacts
  scope). A separate `crm.objects.notes.write` scope is not exposed on many
  accounts and is not required — add it only if your account shows it.
- `crm.schemas.contacts.read`
- `crm.schemas.contacts.write` — only needed to run the property-creation script

Copy the access token into `HUBSPOT_TOKEN`.

### 2. Create the contact properties (scripted, not click-ops)

`hubspot.js` holds the controlled vocabulary (`PROPERTY_DEFS`) shared by the
runtime sync and the provisioning script, so the dropdown internal values can
never drift from the summariser's enums.

```bash
HUBSPOT_TOKEN=pat-xxxx npm run hubspot:properties
```

Idempotent — re-running updates labels/options instead of duplicating. Creates
a **FIT College Advisor** property group with:

| Property                 | Type                 | Values |
| ------------------------ | -------------------- | ------ |
| `fitc_advisor_persona`   | dropdown             | starter, career_changer, returner, insider, unknown |
| `fitc_intent_level`      | dropdown             | hot, warm, cool |
| `fitc_primary_objection` | dropdown             | price, time_flexibility, eligibility_experience, recognition_credit, age, study_confidence, income_viability, none |
| `fitc_booking_status`    | dropdown             | accepted, declined, offered_no_response, not_offered |
| `fitc_course_interest`   | multiple checkboxes  | the course catalog (cert_iii_fitness, … , other) |
| `fitc_kb_gaps`           | multi-line text      | free text |

`syncToHubSpot` sanitises against this vocabulary before writing, so a stray
value from the model is dropped rather than 400-ing the whole update.

### 3. Test against a real contact

```bash
HUBSPOT_TOKEN=pat-xxxx TEST_CONTACT_ID=12345 \
  [TEST_CONTACT_UTK=<hubspotutk>] npm run hubspot:test
```

Writes the `fitc_*` properties and one clearly-marked smoke-test note to that
contact, then verifies the properties saved and the note is associated to the
contact (Note→Contact, association type 202). Use a throwaway test contact.

## Deploying the relay

Configs for two hosts are included; both auto-inject `PORT`, which `server.js`
reads.

- **Render** — `render.yaml` (Blueprint). New → Blueprint → pick this repo. Set
  the `sync: false` secrets (`ANTHROPIC_API_KEY`, `HUBSPOT_TOKEN`,
  `ADMIN_RELOAD_TOKEN`) in the dashboard after the first deploy.
- **Railway** — `railway.json`. Create a service from this repo and set the
  service **Root Directory** to `relay`, then add the env vars in the
  dashboard.

Lock `ALLOWED_ORIGIN` to the live site (`https://www.fitcollege.edu.au`) so only
that origin can call `/chat`.

The widget is served from the relay itself at `GET /widget.js`, so it shares an
origin with `/chat`.

## Embedding on the thank-you page

Add one tag just before `</body>` on `/promo-thanks` (via the CMS), pointing at
your deployed relay:

```html
<script src="https://YOUR-RELAY-HOST/widget.js"
        data-relay="https://YOUR-RELAY-HOST"
        data-meeting="https://meetings.hubspot.com/your-rep"></script>
```

Then confirm the page's Content-Security-Policy (if any) allows the relay origin
in `script-src` and `connect-src` (and `frame-src` for the HubSpot meetings
iframe). Test the full loop: submit the form → land on the thank-you page →
chat → book → check the contact in HubSpot picked up the `fitc_*` properties and
the note.
