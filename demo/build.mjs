// Builds a single self-contained demo page (demo/index.html) by inlining
// widget.js in its built-in demo mode — no relay, no secrets. The canned
// replies below are authored from knowledge-base/kb.md so the demo showcases
// real FIT College facts, and the page auto-plays the conversation.
// Run: node demo/build.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// widget.js contains "</script>" in its header comment; escape it so inlining
// into an HTML <script> block doesn't terminate the tag early.
const widget = fs.readFileSync(path.join(__dirname, '..', 'widget.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

// A scripted, KB-grounded conversation (career-changer persona). The prompts
// are what "Sam" types; the replies are what the advisor says back — both kept
// faithful to knowledge-base/kb.md and the advisor voice in the system prompt.
const prompts = [
  'How long does the Certificate III in Fitness take?',
  "Online — I'm working full-time and want to switch careers.",
  'I want to become a personal trainer eventually. What does it cost?'
];
const replies = [
  "Great question, Sam! You've got up to 12 months, but most online students wrap it up in around 6 — and on campus full-time it's about 8 weeks. Are you leaning towards online, or a campus near you?",
  "That's a really common switch, and it fits well around a full-time job — the online study is self-paced, so you work through it in the gaps and finish on your own timeline. Are you thinking gym instructor to start, or heading straight for personal training?",
  "Nice goal! To train clients as a PT you'd do your Cert III then Cert IV — lots of people bundle both as our FIT Elite package, with interest-free payment plans (and there's an EOFY sale on right now). Exact pricing depends on your path and study mode, so the best next step is a quick chat with an advisor who can give you real numbers and a plan — want me to set that up?"
];

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FIT College — Thanks for your enquiry</title>
  <style>
    :root { --red:#CE2829; --ink:#181818; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
           color:var(--ink); background:#f4f4f5; }
    header { background:var(--ink); color:#fff; padding:18px 24px; position:relative; overflow:hidden; }
    header::after { content:""; position:absolute; left:0; right:0; bottom:0; height:3px;
                    background:var(--red); transform:skewX(-24deg) translateX(-6px); transform-origin:left; }
    .brand { font-weight:700; letter-spacing:2.5px; font-size:18px; }
    .wrap { max-width:680px; margin:48px auto; padding:0 24px; }
    .card { background:#fff; border-radius:16px; padding:40px; box-shadow:0 10px 30px rgba(0,0,0,.06); }
    .tag { display:inline-block; background:rgba(206,40,41,.1); color:var(--red); font-weight:600;
           font-size:12px; letter-spacing:.4px; padding:6px 12px; border-radius:20px; }
    h1 { font-size:28px; margin:16px 0 12px; line-height:1.2; }
    p { color:#555; line-height:1.6; margin-bottom:14px; }
    .note { margin-top:24px; font-size:13px; color:#999; border-top:1px solid #eee; padding-top:16px; }
  </style>
</head>
<body>
  <header><div class="brand">FIT COLLEGE</div></header>
  <div class="wrap">
    <div class="card">
      <span class="tag">ENQUIRY RECEIVED</span>
      <h1>Thanks, Sam — we'll be in touch soon.</h1>
      <p>One of our career advisors will call you shortly to talk through courses,
         start dates and payment plans.</p>
      <p>In the meantime, our Career Advisor (bottom-right) can answer your
         questions right now — this preview plays a short scripted conversation.</p>
      <p class="note">Demo mode: replies are scripted from the knowledge base and
         nothing is sent anywhere. The live widget answers dynamically via the relay.</p>
    </div>
  </div>

  <!-- Scripted, KB-grounded canned replies for the demo. -->
  <script>
    window.FITC_DEMO = ${JSON.stringify(replies)};
  </script>

  <!-- FIT College Career Advisor widget, inlined in demo mode -->
  <script data-demo="true"
          data-firstname="Sam"
          data-meeting="https://meetings.hubspot.com/example/fit-college-demo"
          data-autoopen="700">
${widget}
  </script>

  <!-- Auto-play: type each prompt and send once the widget is idle. -->
  <script>
    (function () {
      var prompts = ${JSON.stringify(prompts)};
      var i = 0;
      function step() {
        if (i >= prompts.length) return;
        var input = document.getElementById('fitc-input');
        var send = document.getElementById('fitc-send');
        if (!input || !send || send.disabled) { setTimeout(step, 300); return; }
        input.value = prompts[i];
        input.dispatchEvent(new Event('input', { bubbles: true }));
        send.click();
        i++;
        setTimeout(step, 1700);
      }
      setTimeout(step, 1500);  // let the panel auto-open and greet first
    })();
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), page);
console.log('Wrote demo/index.html (' + page.length + ' bytes)');
