// server.js — FIT College Career Advisor relay
// Node 18+ (uses global fetch). ES modules: set "type": "module" in package.json.
// Deps: npm i express cors express-rate-limit dotenv

import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.fitcollege.edu.au';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_RELOAD_TOKEN;
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-haiku-4-5-20251001';
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || 'claude-haiku-4-5-20251001';

const MAX_TURNS = 40;      // cap conversation length (cost / abuse guard)
const MAX_CHARS = 4000;    // cap per-message length
const ANTHROPIC_TIMEOUT_MS = 30_000;

if (!ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY — refusing to start.');
  process.exit(1);
}

// ---------- Prompt templates + knowledge base (cached) ----------
const SYSTEM_TEMPLATE = fs.readFileSync(path.join(__dirname, 'prompt/system-prompt.md'), 'utf8');
const SUMMARISER_PROMPT = fs.readFileSync(path.join(__dirname, 'prompt/summariser-prompt.md'), 'utf8');

let knowledgeBase = '';
function loadKnowledgeBase() {
  try {
    knowledgeBase = fs.readFileSync(path.join(__dirname, 'knowledge-base/kb.md'), 'utf8');
    console.log(`Knowledge base loaded (${knowledgeBase.length} chars).`);
  } catch (e) {
    console.error('Failed to load knowledge base:', e.message);
  }
}
loadKnowledgeBase();

function buildSystemPrompt(firstName) {
  return SYSTEM_TEMPLATE
    .replace(/{{FIRST_NAME}}/g, firstName || 'there')
    .replace('{{KNOWLEDGE_BASE}}', knowledgeBase);
}

// ---------- HubSpot (resolve + write-back) ----------
// Both calls fail safe: if HubSpot is unconfigured or errors, the chat still works.
// Endpoints to confirm against current HubSpot v3 docs before going live.
async function resolveContact(utk) {
  if (!utk || !HUBSPOT_TOKEN) return null;
  try {
    // Legacy endpoint, still supported with a private-app token; server-side only (no CORS).
    const res = await fetch(
      `https://api.hubapi.com/contacts/v1/contact/utk/${encodeURIComponent(utk)}/profile?property=firstname`,
      { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}` } }
    );
    if (res.status === 404) return null;            // cookie not tied to a contact yet
    if (!res.ok) throw new Error(`HubSpot ${res.status}`);
    const data = await res.json();
    if (data['is-contact'] === false) return null;
    return {
      contactId: String(data.vid),                  // vid is the same id v3 uses
      firstName: (data.properties && data.properties.firstname && data.properties.firstname.value) || ''
    };
  } catch (e) {
    console.error('Contact resolution failed:', e.message);
    return null;
  }
}

async function syncToHubSpot(contactId, f) {
  if (!contactId || !HUBSPOT_TOKEN) return;
  const headers = {
    'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  };
  try {
    // 1) Structured properties — for filtering, lists and automation.
    await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ properties: {
        fitc_advisor_persona: f.persona,
        fitc_intent_level: f.intent_level,
        fitc_course_interest: (f.course_interest || []).join(';'),
        fitc_primary_objection: f.primary_objection,
        fitc_booking_status: f.booking_status,
        fitc_kb_gaps: (f.kb_gaps || []).join('\n')
      }})
    });

    // 2) Human-readable brief on the contact timeline for the advisor.
    if (f.summary) {
      await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            hs_timestamp: Date.now(),                // required: when the note occurred
            hs_note_body: `FIT College Advisor chat\n\n${f.summary}`
          },
          associations: [{
            to: { id: contactId },
            // 202 = Note -> Contact (we POST from the note, so the note is the "from")
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }]
          }]
        })
      });
    }
  } catch (e) {
    console.error('HubSpot sync failed:', e.message);
  }
}

// ---------- Anthropic call (with timeout) ----------
async function callAnthropic({ model, system, messages, maxTokens }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Input validation ----------
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array';
  if (messages.length > MAX_TURNS) return 'conversation too long';
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return 'invalid message role';
    if (typeof m.content !== 'string' || m.content.length === 0) return 'invalid message content';
    if (m.content.length > MAX_CHARS) return 'message too long';
  }
  if (messages[0].role !== 'user') return 'conversation must start with a user message';
  return null;
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cors({ origin: ALLOWED_ORIGIN, methods: ['POST'] }));

const chatLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

app.get('/health', (_req, res) => res.json({ ok: true }));

// POST /chat  { utk, messages:[{role, content}] }  ->  { reply, offerBooking }
app.post('/chat', chatLimiter, async (req, res) => {
  const { utk, messages } = req.body || {};
  const err = validateMessages(messages);
  if (err) return res.status(400).json({ error: err });

  try {
    const contact = await resolveContact(utk);             // name personalisation (fail-safe)
    const system = buildSystemPrompt(contact?.firstName);
    const raw = await callAnthropic({ model: CHAT_MODEL, system, messages, maxTokens: 1024 });

    const offerBooking = raw.includes('[[OFFER_BOOKING]]'); // control signal for the widget
    const reply = raw.replace(/\[\[OFFER_BOOKING\]\]/g, '').trim();
    res.json({ reply, offerBooking });
  } catch (e) {
    console.error('/chat error:', e.message);              // never leak internals to client
    res.status(502).json({ error: 'advisor_unavailable' });
  }
});

// POST /summarise  { utk, messages }  ->  202 (acks immediately, syncs async)
app.post('/summarise', async (req, res) => {
  const { utk, messages } = req.body || {};
  const err = validateMessages(messages);
  if (err) return res.status(400).json({ error: err });

  res.status(202).json({ ok: true });                      // never block the user or the booking

  (async () => {
    try {
      const contact = await resolveContact(utk);
      if (!contact) return;                                // nothing to sync to
      const transcript = messages
        .map(m => `${m.role === 'user' ? 'Prospect' : 'Advisor'}: ${m.content}`)
        .join('\n');
      const raw = await callAnthropic({
        model: SUMMARY_MODEL,
        system: SUMMARISER_PROMPT,
        messages: [{ role: 'user', content: transcript }],
        maxTokens: 500
      });
      let fields;
      try {
        fields = JSON.parse(raw.replace(/```json|```/g, '').trim());
      } catch (e) {
        console.error('Summariser parse failed — skipping sync:', e.message, raw);
        return;
      }
      await syncToHubSpot(contact.contactId, fields);
      // TODO: persistTranscript(contact.contactId, messages, fields) for the Admin Console inbox.
    } catch (e) {
      console.error('Summarise/sync failed:', e.message);
    }
  })();
});

// POST /admin/reload-kb  (header: x-admin-token)  -> reload KB after a console export
app.post('/admin/reload-kb', (req, res) => {
  if (!ADMIN_TOKEN || req.get('x-admin-token') !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'forbidden' });
  }
  loadKnowledgeBase();
  res.json({ ok: true, chars: knowledgeBase.length });
});

app.listen(PORT, () => console.log(`Relay listening on :${PORT} (origin: ${ALLOWED_ORIGIN})`));
