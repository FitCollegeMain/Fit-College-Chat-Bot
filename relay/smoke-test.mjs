// smoke-test.mjs — boots the relay and exercises every endpoint.
// Run with: npm test   (no real API key needed)
//
// Uses a placeholder ANTHROPIC_API_KEY: the server still boots and /chat still
// reaches the Anthropic API, which rejects the key — so the deterministic,
// offline-checkable contract is a 502 ("advisor_unavailable"). This verifies
// validation, admin auth, KB loading and the error-handling path. For a live
// model reply, run the server with a real key and POST /chat manually.

import { spawn } from 'node:child_process';

const PORT = process.env.SMOKE_PORT || 3999;
const ADMIN_TOKEN = 'smoke-admin-token';
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function req(method, path, { body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function run() {
  let r;

  console.log('GET /health');
  r = await req('GET', '/health');
  check('200 + {ok:true}', r.status === 200 && r.json?.ok === true, `got ${r.status} ${JSON.stringify(r.json)}`);

  console.log('GET /widget.js');
  {
    const res = await fetch(`${BASE}/widget.js`);
    const body = await res.text();
    check('200 + JS content-type + widget body',
      res.ok && /javascript/.test(res.headers.get('content-type') || '') && body.includes('fitc-launch'),
      `got ${res.status} ${res.headers.get('content-type')}`);
  }

  console.log('POST /chat — validation');
  r = await req('POST', '/chat', { body: { messages: [] } });
  check('empty messages → 400', r.status === 400, `got ${r.status}`);

  r = await req('POST', '/chat', { body: { messages: [{ role: 'assistant', content: 'hi' }] } });
  check('starts with assistant → 400', r.status === 400, `got ${r.status}`);

  r = await req('POST', '/chat', { body: { messages: [{ role: 'user', content: '' }] } });
  check('empty content → 400', r.status === 400, `got ${r.status}`);

  console.log('POST /admin/reload-kb — auth');
  r = await req('POST', '/admin/reload-kb', { headers: { 'x-admin-token': 'wrong' } });
  check('wrong token → 403', r.status === 403, `got ${r.status}`);

  r = await req('POST', '/admin/reload-kb', { headers: { 'x-admin-token': ADMIN_TOKEN } });
  check('correct token → 200 + char count', r.status === 200 && r.json?.ok === true && r.json?.chars > 0,
    `got ${r.status} ${JSON.stringify(r.json)}`);

  console.log('POST /chat — reaches Anthropic (placeholder key → 502)');
  r = await req('POST', '/chat', { body: { messages: [{ role: 'user', content: 'What is the Cert III in Fitness?' }] } });
  check('valid message → 502 advisor_unavailable', r.status === 502 && r.json?.error === 'advisor_unavailable',
    `got ${r.status} ${JSON.stringify(r.json)}`);

  console.log('POST /summarise — acks immediately');
  r = await req('POST', '/summarise', { body: { messages: [{ role: 'user', content: 'hi' }] } });
  check('valid → 202', r.status === 202, `got ${r.status}`);
}

const server = spawn('node', ['server.js'], {
  cwd: import.meta.dirname,
  env: { ...process.env, ANTHROPIC_API_KEY: 'smoke-test-key', ADMIN_RELOAD_TOKEN: ADMIN_TOKEN, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', d => serverLog.push(d.toString()));
server.stderr.on('data', d => serverLog.push(d.toString()));

let exitCode = 1;
try {
  if (!(await waitForHealth())) {
    console.error('Server did not become healthy in time. Output:\n' + serverLog.join(''));
  } else {
    console.log('Server up — running checks\n');
    await run();
    console.log(`\n${passed} passed, ${failed} failed`);
    exitCode = failed === 0 ? 0 : 1;
  }
} catch (e) {
  console.error('Smoke test crashed:', e);
} finally {
  server.kill('SIGTERM');
  process.exit(exitCode);
}
