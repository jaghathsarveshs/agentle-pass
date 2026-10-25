# AGENTle Pass

**Good handoffs. Fewer facepalms.**

AGENTle Pass is a checked handoff between two AI specialists. A **Research** agent turns your request into a structured task contract, you approve it, ordinary code validates it, and only then does a separate **Coding** agent write a Python file from it.

> Track 2 · Agentic AI · Cognition 2026 · **Team Quadra**

---

## The problem

When one AI agent hands work to another, context gets lost at the boundary: the intent, the rules ("standard library only", "no external APIs") and the reasons behind earlier decisions. The receiving agent never learns the rules, so it breaks them. Like a game of telephone, the message changes as it's passed along, and nobody notices.

## The idea

Don't pass a paragraph. Pass a **task contract** and check it before the next agent starts.

- **Rules are quoted, not paraphrased.** Every rule Research extracts is linked to the exact words from your prompt. Rules without a verified quote are labelled as AI proposals.
- **You approve before anything moves.** The approved goal and rules are saved on the server as the contract, so the travelling packet can never grade its own homework.
- **Code checks the handoff, not another AI.** A deterministic checkpoint compares the packet with the contract before Coding is allowed to run.
- **Reasons and attempts travel too.** The packet carries why you chose something, what was already tried, and what is still unanswered.
- **Failures are handled, not hidden.** The app repairs a damaged packet once from the saved copy, asks you, or stops. It never quietly relaxes a rule.
- **Evidence goes stale.** Results are tied to fingerprints (SHA-256). Edit the packet or the code and the old "pass" no longer counts until you recheck.

## How it works

```
You ──▶ Research agent ──▶ You review & approve ──▶ Checkpoint (code) ──PASS──▶ Coding agent ──▶ Static scan
                                                         │
                                                       FAIL
                                                         ▼
                                    Repair once / ask you ──▶ check again ──▶ still failing? stop
```

1. **Describe.** Type one normal request for a small Python tool.
2. **Research.** The NVIDIA model extracts the goal, source-quoted rules, reasons, previous attempts, open questions and a short design.
3. **Review.** Inspect each rule's source, include or dismiss possible omissions, ask Research a question, or send an answer that updates the task (2 rounds maximum).
4. **Check.** The checkpoint runs 5 checks:

   | Check | What it confirms |
   |---|---|
   | Packet structure | Valid HandoffState JSON with every required field |
   | Confirmed goal and rules | Goal and every approved rule match the contract; nothing added |
   | Registered source and findings | Original prompt and Research findings match their SHA-256 hashes |
   | Instruction authority | Reference-only notes (e.g. "Background notes:") cannot override rules |
   | No blocking questions | Nothing essential is unanswered |

5. **Code.** A separate conversation with the same model writes one Python file from the checked packet.
6. **Scan.** The code is checked statically against each rule (Pass / Fail / Manual review). **It is never executed.**

Both specialists use the same NVIDIA-hosted model in separate conversations. The checkpoint is plain code, not a third agent.

## Features

- Source quotes for every rule, with AI proposals clearly labelled
- Possible-omission hints you can include or dismiss
- Focused questions to Research, with bounded correction rounds
- Background notes treated as reference data, never as instructions
- Activity log, versioned check records and a receipt bound to the packet hash
- Editable packet JSON and code, with automatic staleness and recheck
- **Compare handoffs:** run Coding again from a plain-text message and compare static check results side by side
- Saved runs, downloadable evidence (JSON) and a resume brief for continuing in a new chat
- Download the generated `.py` file

## Test fixtures (fault injection)

Checks run on **every** run. The *Test fixtures* menu deliberately damages the packet after approval so you can watch the checkpoint catch it. These are injected faults, not observed AI mistakes.

| Injected fault | Response |
|---|---|
| Broken JSON | Reject, repair once from the saved copy, recheck |
| Missing rule | Reject, restore, recheck |
| Wrong task | Stop and ask you to confirm the task ID |
| Missing source | Stop and ask you to confirm the source |
| Changed research | Hash mismatch: reject, restore |
| Background override | Authority check fails: reject, restore |

## Tech stack

| Part | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (no framework) |
| Backend | Node.js (built-in `http`, no dependencies) |
| AI | NVIDIA API (`integrate.api.nvidia.com`): `nvidia/nemotron-3.5-lightning-30b-a3b`, falling back to `openai/gpt-oss-20b` |
| Handoff format | HandoffState JSON v1.1 |
| Integrity | SHA-256 fingerprints for artifacts, packets and code |
| Storage | One JSON file per run in `data/runs/` (no database) |

Every model call is logged with the requested and returned model, time, tokens and retry count (see *View details → Technical details*).

## Run it locally

**Requirements:** Node.js 20 or newer and an NVIDIA API key from [build.nvidia.com](https://build.nvidia.com).

```bash
git clone https://github.com/jaghathsarveshs/agentle-pass.git
cd agentle-pass
cp .env.example .env      # on Windows PowerShell: copy .env.example .env
```

Open `.env` and set your key:

```
NVIDIA_API_KEY=your-nvidia-api-key
NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
NVIDIA_FALLBACK_MODEL=openai/gpt-oss-20b
PORT=8000
```

Start the server:

```bash
npm start
```

Then open **http://127.0.0.1:8000**. No `npm install` is needed because there are no dependencies.

**Quick demo:** click *Try an example* → *Start Research* → review the rules → *Looks right. Check & code*. Then try a fault from *Test fixtures* (bottom right) and open *View details → Activity log* to see the checkpoint reject and recover.

## Project structure

```
agentle-pass/
├── server.js          # API, research/coding calls, checkpoint, static scan, saved runs
├── package.json
├── .env.example       # copy to .env and add your key
└── public/
    ├── index.html     # the interface
    ├── style.css
    ├── live.js        # UI logic: polls the server for run state
    └── assets/        # logo
```

## Limitations

We aim to be precise about what this does and doesn't prove:

- **It can't restore what was never captured.** If Research misses an instruction and you approve without noticing, the saved contract misses it too. That is why the review step matters.
- **Contradictions aren't detected automatically.** Research may flag one, and the code scan may then fail a rule, but nothing forces a question.
- **Static checks only.** Generated code is scanned, never run. "Pass" means the pattern was found, not that the program works.
- **A matching hash proves nothing changed, not that the content is true.**
- **Better handoffs ≠ guaranteed better code.** On clean runs, plain text and AGENTle Pass often tie. The proven strength is detecting and blocking lost or altered instructions before Coding runs.
- Saved runs are plain local files, not encrypted. Don't put secrets in prompts.

## Future scope

- Sandboxed execution with runtime tests
- A matched fault test: the same damaged handoff given to plain text and to AGENTle Pass, side by side
- A third specialist (e.g. a deploy agent) on the same checked protocol
- Behaviour tests beyond static scans

## Team Quadra

- Jaghath Sarvesh
- Bharatheshwar V
- Kavin B
- Nithin Eapen Zachariah

Built for **Cognition 2026 · Track 2: Agentic AI**.
