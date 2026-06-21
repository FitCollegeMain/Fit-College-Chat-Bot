// Creates the six fitc_* contact properties the chat relay writes to.
//
// Usage:
//   HUBSPOT_TOKEN=pat-... npm run hubspot:properties
//
// Idempotent: an existing property is left untouched and reported as "exists".
// Requires a HubSpot private-app token with crm.schemas.contacts.write scope.

const TOKEN = process.env.HUBSPOT_TOKEN;
const BASE = 'https://api.hubapi.com/crm/v3/properties/contacts';
const GROUP = 'contactinformation'; // default contact property group, always present

if (!TOKEN) {
  console.error('Missing HUBSPOT_TOKEN. Run: HUBSPOT_TOKEN=pat-... npm run hubspot:properties');
  process.exit(1);
}

// Property definitions mirror summariser-prompt.md and server.js syncToHubSpot().
// Fixed value sets -> enumeration/select. Free-form values -> text/textarea.
const PROPERTIES = [
  {
    name: 'fitc_advisor_persona',
    label: 'FITC Advisor Persona',
    type: 'enumeration',
    fieldType: 'select',
    options: ['starter', 'career_changer', 'returner', 'insider', 'unknown']
  },
  {
    name: 'fitc_intent_level',
    label: 'FITC Intent Level',
    type: 'enumeration',
    fieldType: 'select',
    options: ['hot', 'warm', 'cool']
  },
  {
    name: 'fitc_course_interest',
    label: 'FITC Course Interest',
    // Free-form course names, stored ';'-joined by the relay.
    type: 'string',
    fieldType: 'text'
  },
  {
    name: 'fitc_primary_objection',
    label: 'FITC Primary Objection',
    type: 'enumeration',
    fieldType: 'select',
    options: [
      'price', 'time_flexibility', 'eligibility_experience', 'recognition_credit',
      'age', 'study_confidence', 'income_viability', 'none'
    ]
  },
  {
    name: 'fitc_booking_status',
    label: 'FITC Booking Status',
    type: 'enumeration',
    fieldType: 'select',
    options: ['accepted', 'declined', 'offered_no_response', 'not_offered']
  },
  {
    name: 'fitc_kb_gaps',
    label: 'FITC Knowledge-Base Gaps',
    // Free-form questions, stored newline-joined by the relay.
    type: 'string',
    fieldType: 'textarea'
  }
];

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

function buildPayload(def) {
  const payload = {
    name: def.name,
    label: def.label,
    type: def.type,
    fieldType: def.fieldType,
    groupName: GROUP
  };
  if (def.options) {
    payload.options = def.options.map((value, i) => ({
      label: value,
      value,
      displayOrder: i,
      hidden: false
    }));
  }
  return payload;
}

async function ensureProperty(def) {
  // Already there? Leave it alone.
  const existing = await fetch(`${BASE}/${def.name}`, { headers });
  if (existing.ok) return { name: def.name, status: 'exists' };
  if (existing.status !== 404) {
    const body = await existing.text();
    throw new Error(`GET ${def.name} -> ${existing.status}: ${body}`);
  }

  const res = await fetch(BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildPayload(def))
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST ${def.name} -> ${res.status}: ${body}`);
  }
  return { name: def.name, status: 'created' };
}

async function main() {
  console.log(`Ensuring ${PROPERTIES.length} fitc_* contact properties in HubSpot...\n`);
  const results = [];
  let failed = false;

  for (const def of PROPERTIES) {
    try {
      const r = await ensureProperty(def);
      results.push(r);
      console.log(`  ${r.status === 'created' ? '✓ created' : '• exists  '}  ${r.name}`);
    } catch (e) {
      failed = true;
      results.push({ name: def.name, status: 'error', error: e.message });
      console.error(`  ✗ error   ${def.name}\n      ${e.message}`);
    }
  }

  const created = results.filter(r => r.status === 'created').length;
  const exists = results.filter(r => r.status === 'exists').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log(`\nDone. created=${created} exists=${exists} errors=${errors} ` +
              `(${created + exists}/${PROPERTIES.length} present)`);

  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('Unexpected failure:', e);
  process.exit(1);
});
