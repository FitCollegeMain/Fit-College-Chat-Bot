# Widget demo

A self-contained preview of the FIT College Career Advisor widget.

## Just look at it

Open **`index.html`** in any browser — double-click it, no server or API key
needed. It runs the widget in **demo mode**: the panel auto-opens, replies are
canned, and nothing is sent anywhere. This is the exact UX that appears on the
live site.

`shot-1-greeting.png`, `shot-2-conversation.png` and `shot-3-booking.png` show
it rendered (greeting → conversation → booking hand-off). The white area in the
booking card is where the live HubSpot meeting calendar embeds (the demo uses a
placeholder link).

## Point it at a real relay

To preview real Claude replies instead of canned ones, edit the script tag at
the bottom of `index.html` (or embed `../widget.js` on a page) and set:

```html
<script src="../widget.js"
        data-relay="https://your-relay.example.com"
        data-meeting="https://meetings.hubspot.com/your-rep"></script>
```

With `data-relay` set, the widget calls the deployed relay (`/chat`,
`/summarise`) instead of using demo mode.

## Rebuild / re-capture

```bash
node demo/build.mjs        # regenerate index.html from widget.js
NODE_PATH=/path/to/global/node_modules node demo/screenshot.cjs   # re-capture (needs Playwright)
```

`index.html` is generated from `widget.js`, so rebuild after changing the
widget.
