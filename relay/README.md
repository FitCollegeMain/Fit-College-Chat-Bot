# FIT College Chat Relay — HubSpot setup

Utilities for provisioning the HubSpot side of the Career Advisor chat relay.

## Step 2 — create contact properties

Creates the six `fitc_*` contact properties that the relay writes to after a
chat (see `server.js` → `syncToHubSpot`). Requires a HubSpot private-app token
with the `crm.schemas.contacts.write` scope.

```bash
cd relay
npm ci
HUBSPOT_TOKEN=pat-... npm run hubspot:properties
```

The script is idempotent: properties that already exist are reported as
`exists` and left unchanged; only missing ones are created.

| Property | Type | Values |
| --- | --- | --- |
| `fitc_advisor_persona` | select | starter, career_changer, returner, insider, unknown |
| `fitc_intent_level` | select | hot, warm, cool |
| `fitc_course_interest` | text | free-form, `;`-joined course names |
| `fitc_primary_objection` | select | price, time_flexibility, eligibility_experience, recognition_credit, age, study_confidence, income_viability, none |
| `fitc_booking_status` | select | accepted, declined, offered_no_response, not_offered |
| `fitc_kb_gaps` | textarea | free-form, newline-joined questions |
