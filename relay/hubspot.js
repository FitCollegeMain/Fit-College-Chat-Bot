// hubspot.js — HubSpot integration for the FIT College relay.
// Extracted from server.js so the same code path is unit-testable (see
// scripts/test-hubspot.mjs) and the controlled vocabulary has ONE home
// (PROPERTY_DEFS), shared by the runtime sync and the property-creation script.
//
// Token is read from process.env.HUBSPOT_TOKEN at call time (not import time)
// so the one-off scripts can set it however they like. Every call fails safe:
// if HubSpot is unconfigured or errors, the chat keeps working.

const API = 'https://api.hubapi.com';

// ---------------------------------------------------------------------------
// Controlled vocabulary — the SINGLE SOURCE OF TRUTH for the fitc_* properties.
//
// `field`     — the key the summariser emits (see prompt/summariser-prompt.md)
// `name`      — the HubSpot contact property internal name
// `fieldType` — 'select' (single dropdown) | 'checkbox' (multi) | 'textarea' (free text)
// `options`   — internal values MUST match the summariser's enums exactly.
//
// Editing this list changes BOTH what `npm run hubspot:properties` creates and
// what syncToHubSpot is willing to write — they can never drift apart.
// ---------------------------------------------------------------------------
export const PROPERTY_GROUP = { name: 'fit_college_advisor', label: 'FIT College Advisor' };

export const PROPERTY_DEFS = [
  {
    field: 'persona',
    name: 'fitc_advisor_persona',
    label: 'Advisor Persona',
    type: 'enumeration',
    fieldType: 'select',
    description: 'Lead persona inferred by the Career Advisor chat.',
    options: [
      { label: 'Starter', value: 'starter' },
      { label: 'Career changer', value: 'career_changer' },
      { label: 'Returner', value: 'returner' },
      { label: 'Insider', value: 'insider' },
      { label: 'Unknown', value: 'unknown' },
    ],
  },
  {
    field: 'intent_level',
    name: 'fitc_intent_level',
    label: 'Intent Level',
    type: 'enumeration',
    fieldType: 'select',
    description: 'Buying intent inferred from the chat.',
    options: [
      { label: 'Hot', value: 'hot' },
      { label: 'Warm', value: 'warm' },
      { label: 'Cool', value: 'cool' },
    ],
  },
  {
    field: 'primary_objection',
    name: 'fitc_primary_objection',
    label: 'Primary Objection',
    type: 'enumeration',
    fieldType: 'select',
    description: 'The single biggest hesitation the prospect voiced.',
    options: [
      { label: 'Price', value: 'price' },
      { label: 'Time / flexibility', value: 'time_flexibility' },
      { label: 'Eligibility / experience', value: 'eligibility_experience' },
      { label: 'Recognition / credit', value: 'recognition_credit' },
      { label: 'Age', value: 'age' },
      { label: 'Study confidence', value: 'study_confidence' },
      { label: 'Income viability', value: 'income_viability' },
      { label: 'None', value: 'none' },
    ],
  },
  {
    field: 'booking_status',
    name: 'fitc_booking_status',
    label: 'Booking Status',
    type: 'enumeration',
    fieldType: 'select',
    description: 'What the chat shows about the booking offer.',
    options: [
      { label: 'Accepted', value: 'accepted' },
      { label: 'Declined', value: 'declined' },
      { label: 'Offered, no response', value: 'offered_no_response' },
      { label: 'Not offered', value: 'not_offered' },
    ],
  },
  {
    field: 'course_interest',
    name: 'fitc_course_interest',
    label: 'Course Interest',
    type: 'enumeration',
    fieldType: 'checkbox', // multiple — stored as a ';'-joined string in HubSpot
    description: 'Course(s) the prospect discussed in the chat.',
    options: [
      { label: 'Certificate III in Fitness', value: 'cert_iii_fitness' },
      { label: 'Certificate IV in Fitness', value: 'cert_iv_fitness' },
      { label: 'Certificate III & IV in Fitness', value: 'cert_iii_iv_fitness' },
      { label: 'FIT Elite Personal Trainer', value: 'fit_elite_pt' },
      { label: 'Strength & Conditioning (ASCA L1)', value: 'strength_conditioning' },
      { label: 'Diploma of Sport (Coaching)', value: 'diploma_sport_coaching' },
      { label: 'Cert IV Training & Assessment (TAE)', value: 'tae40122' },
      { label: 'First Aid / CPR', value: 'first_aid' },
      { label: 'Disability Support', value: 'disability_support' },
      { label: 'Certificate III in Travel', value: 'cert_iii_travel' },
      { label: 'Other / undecided', value: 'other' },
    ],
  },
  {
    field: 'kb_gaps',
    name: 'fitc_kb_gaps',
    label: 'Knowledge Base Gaps',
    type: 'string',
    fieldType: 'textarea', // free text — stored as a newline-joined string
    description: 'Questions the bot could not answer from its knowledge base.',
  },
];

// name -> Set(valid option values), for enumeration properties only.
const ENUM_VALUES = Object.fromEntries(
  PROPERTY_DEFS.filter(d => d.type === 'enumeration')
    .map(d => [d.name, new Set(d.options.map(o => o.value))])
);

// Build the HubSpot `properties` payload from a summariser result, dropping any
// enum value not in the controlled vocabulary so one stray LLM token can never
// 400 the whole PATCH (which would lose every property for that contact).
export function buildProperties(f = {}) {
  const props = {};
  for (const def of PROPERTY_DEFS) {
    const raw = f[def.field];
    if (raw == null) continue;

    if (def.fieldType === 'select') {
      if (ENUM_VALUES[def.name].has(raw)) props[def.name] = raw;
    } else if (def.fieldType === 'checkbox') {
      const valid = (Array.isArray(raw) ? raw : [raw]).filter(v => ENUM_VALUES[def.name].has(v));
      if (valid.length) props[def.name] = valid.join(';');
    } else { // textarea / free text
      const text = Array.isArray(raw) ? raw.join('\n') : String(raw);
      if (text.trim()) props[def.name] = text;
    }
  }
  return props;
}

// ---------------------------------------------------------------------------
// Runtime integration
// ---------------------------------------------------------------------------

// Resolve a contact from the hubspotutk cookie (name personalisation).
export async function resolveContact(utk) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!utk || !token) return null;
  try {
    // Legacy endpoint, still supported with a private-app token; server-side only (no CORS).
    const res = await fetch(
      `${API}/contacts/v1/contact/utk/${encodeURIComponent(utk)}/profile?property=firstname`,
      { headers: { 'Authorization': `Bearer ${token}` } }
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

// Write structured properties + a timeline note back to the contact.
export async function syncToHubSpot(contactId, f) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!contactId || !token) return;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  try {
    // 1) Structured properties — for filtering, lists and automation.
    const properties = buildProperties(f);
    if (Object.keys(properties).length) {
      await fetch(`${API}/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties })
      });
    }

    // 2) Human-readable brief on the contact timeline for the advisor.
    if (f.summary) {
      await fetch(`${API}/crm/v3/objects/notes`, {
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
