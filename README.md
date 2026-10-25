# AGENTle Pass

Good handoffs. Fewer facepalms. A Research AI turns your task into a checked handoff packet, and a separate Coding AI writes one Python file from it. Both use NVIDIA.

## Run it

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and put your NVIDIA key in it:
   ```
   NVIDIA_API_KEY=nvapi-...
   NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
   NVIDIA_FALLBACK_MODEL=openai/gpt-oss-20b
   PORT=8000
   ```
3. Start: `npm start`
4. Open http://127.0.0.1:8000

No `npm install` is needed. There are no dependencies.

## Files

- `public/`: the UI (index.html, style.css, live.js, assets)
- `server.js`: serves the UI and the `/api/*` routes: research, contract review, handoff checks, test fixtures, coding, plain-text comparison, saved runs, evidence export
- `data/runs/`: saved runs (private JSON files, not encrypted)

The generated Python is checked statically and is never executed by the server.
