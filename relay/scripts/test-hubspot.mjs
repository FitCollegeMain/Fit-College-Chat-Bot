// test-hubspot.mjs — exercises the real resolveContact + syncToHubSpot paths
// against a live HubSpot test contact, then verifies the timeline note landed
// with the correct Note->Contact association.
//
// Requires a private-app token with scopes:
//   crm.objects.contacts.read / .write
//   (the timeline note is an engagement and is authorised by contacts.write —
//    there is no separate notes scope on most accounts)
//
// Usage — at minimum a contact id; utk is optional (tests name resolution):
//   HUBSPOT_TOKEN=pat-xxxx TEST_CONTACT_ID=12345 \
//   [TEST_CONTACT_UTK=<hubspotutk cookie>] node scripts/test-hubspot.mjs
//   (or: ... npm run hubspot:test)
//
// Safe to run against a throwaway test contact: it writes the fitc_* properties
// and adds one note clearly marked as a smoke test.

import 'dotenv/config';
import { resolveContact, syncToHubSpot, PROPERTY_DEFS } from '../hubspot.js';

const API = 'https://api.hubapi.com';
const TOKEN = process.env.HUBSPOT_TOKEN;
const UTK = process.env.TEST_CONTACT_UTK;
let CONTACT_ID = process.env.TEST_CONTACT_ID;

if (!TOKEN) {
  console.error('Missing HUBSPOT_TOKEN.');
  process.exit(1);
}
if (!CONTACT_ID && !UTK) {
  console.error('Provide TEST_CONTACT_ID and/or TEST_CONTACT_UTK.');
  process.exit(1);
}

const MARKER = `smoke-${Date.now()}`;
const sampleFields = {
  persona: 'career_changer',
  intent_level: 'warm',
  course_interest: ['cert_iii_iv_fitness', 'strength_conditioning'],
  primary_objection: 'price',
  booking_status: 'offered_no_response',
  summary: `Smoke test from test-hubspot.mjs (${MARKER}). Safe to delete.`,
  kb_gaps: ['Does FIT College run weekend campus classes?'],
};

async function hs(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { ok: res.ok, status: res.status, json, text };
}

let failed = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failed++;
};

(async () => {
  // 1) resolveContact (optional — only if a utk is provided)
  if (UTK) {
    console.log('resolveContact(utk)');
    const c = await resolveContact(UTK);
    ok('resolves to a contact', !!c, 'returned null (utk not tied to a contact, or scope/token issue)');
    if (c) {
      console.log(`    -> contactId=${c.contactId} firstName="${c.firstName}"`);
      if (!CONTACT_ID) CONTACT_ID = c.contactId;
    }
  }

  if (!CONTACT_ID) {
    console.log('\nNo contact id available — cannot test syncToHubSpot. Provide TEST_CONTACT_ID.');
    process.exit(failed ? 1 : 0);
  }

  // 2) syncToHubSpot — write properties + note
  console.log('\nsyncToHubSpot(contactId, fields)');
  await syncToHubSpot(CONTACT_ID, sampleFields);

  // 3) Verify properties landed
  const propNames = PROPERTY_DEFS.map(d => d.name).join(',');
  const after = await hs('GET', `/crm/v3/objects/contacts/${CONTACT_ID}?properties=${propNames}`);
  ok('contact readable after sync', after.ok, `${after.status} ${after.text}`);
  if (after.ok) {
    const p = after.json.properties || {};
    ok('fitc_advisor_persona = career_changer', p.fitc_advisor_persona === 'career_changer', `got "${p.fitc_advisor_persona}"`);
    ok('fitc_intent_level = warm', p.fitc_intent_level === 'warm', `got "${p.fitc_intent_level}"`);
    ok('fitc_primary_objection = price', p.fitc_primary_objection === 'price', `got "${p.fitc_primary_objection}"`);
    ok('fitc_course_interest has both checkboxes',
      (p.fitc_course_interest || '').split(';').sort().join(',') === 'cert_iii_iv_fitness,strength_conditioning',
      `got "${p.fitc_course_interest}"`);
    ok('fitc_kb_gaps populated', !!(p.fitc_kb_gaps && p.fitc_kb_gaps.length), `got "${p.fitc_kb_gaps}"`);
  }

  // 4) Verify the note landed on the timeline with the right association
  console.log('\nVerifying timeline note + association');
  const assoc = await hs('GET', `/crm/v4/objects/contacts/${CONTACT_ID}/associations/notes?limit=100`);
  ok('contact has associated notes', assoc.ok && (assoc.json?.results?.length > 0), `${assoc.status} ${assoc.text}`);

  if (assoc.ok && assoc.json?.results?.length) {
    const noteIds = assoc.json.results.map(r => r.toObjectId);
    let found = null;
    for (const id of noteIds.slice(-10).reverse()) {
      const note = await hs('GET', `/crm/v3/objects/notes/${id}?properties=hs_note_body`);
      if (note.ok && (note.json.properties?.hs_note_body || '').includes(MARKER)) { found = note.json; break; }
    }
    ok('our note is associated to the contact', !!found, 'note with smoke marker not found among associations');
    if (found) ok('note body has advisor heading', found.properties.hs_note_body.startsWith('FIT College Advisor chat'),
      `body="${found.properties.hs_note_body.slice(0, 40)}…"`);
  }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('Crashed:', e); process.exit(1); });
