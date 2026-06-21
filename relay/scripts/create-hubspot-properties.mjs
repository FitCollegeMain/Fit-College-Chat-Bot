// create-hubspot-properties.mjs — one-off, idempotent.
//
// Creates the FIT College Advisor property group and the fitc_* contact
// properties (with dropdown internal values matching the summariser enums)
// via the HubSpot CRM properties API. Definitions come from ../hubspot.js so
// the runtime sync and these properties can never drift apart.
//
// Requires a private-app token with scopes:
//   crm.schemas.contacts.write  (create/update properties + groups)
//   crm.schemas.contacts.read
//
// Usage:
//   HUBSPOT_TOKEN=pat-xxxx node scripts/create-hubspot-properties.mjs
//   (or: HUBSPOT_TOKEN=... npm run hubspot:properties)
//
// Re-running is safe: existing group/properties are updated (label, options,
// description), not duplicated. Existing options are never deleted by HubSpot.

import { PROPERTY_GROUP, PROPERTY_DEFS } from '../hubspot.js';

const API = 'https://api.hubapi.com';
const TOKEN = process.env.HUBSPOT_TOKEN;

if (!TOKEN) {
  console.error('Missing HUBSPOT_TOKEN. Run: HUBSPOT_TOKEN=pat-xxxx npm run hubspot:properties');
  process.exit(1);
}

async function hs(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function ensureGroup() {
  const get = await hs('GET', `/crm/v3/properties/contacts/groups/${PROPERTY_GROUP.name}`);
  if (get.ok) {
    console.log(`• group "${PROPERTY_GROUP.name}" already exists`);
    return;
  }
  if (get.status !== 404) throw new Error(`group lookup failed: ${get.status} ${get.text}`);
  const created = await hs('POST', '/crm/v3/properties/contacts/groups', {
    name: PROPERTY_GROUP.name,
    label: PROPERTY_GROUP.label,
    displayOrder: -1,
  });
  if (!created.ok) throw new Error(`group create failed: ${created.status} ${created.text}`);
  console.log(`✓ created group "${PROPERTY_GROUP.name}"`);
}

function payloadFor(def) {
  const p = {
    name: def.name,
    label: def.label,
    type: def.type,
    fieldType: def.fieldType,
    groupName: PROPERTY_GROUP.name,
    description: def.description || '',
  };
  if (def.options) {
    p.options = def.options.map((o, i) => ({ label: o.label, value: o.value, displayOrder: i }));
  }
  return p;
}

async function ensureProperty(def) {
  const get = await hs('GET', `/crm/v3/properties/contacts/${def.name}`);
  const payload = payloadFor(def);

  if (get.ok) {
    // Update label/description/options; name, type and fieldType are immutable.
    const { name, type, fieldType, groupName, ...patch } = payload;
    const upd = await hs('PATCH', `/crm/v3/properties/contacts/${def.name}`, patch);
    if (!upd.ok) throw new Error(`update ${def.name} failed: ${upd.status} ${upd.text}`);
    console.log(`• updated ${def.name} (${def.fieldType}${def.options ? `, ${def.options.length} options` : ''})`);
    return;
  }
  if (get.status !== 404) throw new Error(`lookup ${def.name} failed: ${get.status} ${get.text}`);

  const created = await hs('POST', '/crm/v3/properties/contacts', payload);
  if (!created.ok) throw new Error(`create ${def.name} failed: ${created.status} ${created.text}`);
  console.log(`✓ created ${def.name} (${def.fieldType}${def.options ? `, ${def.options.length} options` : ''})`);
}

(async () => {
  try {
    console.log(`Provisioning ${PROPERTY_DEFS.length} contact properties on HubSpot…\n`);
    await ensureGroup();
    for (const def of PROPERTY_DEFS) await ensureProperty(def);
    console.log('\nDone. Properties are live under the "FIT College Advisor" group on the Contact object.');
  } catch (e) {
    console.error('\nFailed:', e.message);
    process.exit(1);
  }
})();
