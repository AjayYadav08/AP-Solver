# AP-Solver: 3-Section Fullstack & API Challenge Copilot

An autonomous Manifest V3 Chrome Extension designed specifically for 3-section live coding platforms (e.g. Newton School's Question + VS Code Web + HTTP Request interfaces).

AP-Solver reads the complete problem statement, endpoints table, container `package.json`, and grading test files, generates bug-free solutions via Turbo Race AI (Groq LPU & Google Gemini), writes files directly to the container disk via Terminal (`base64`), executes any required post-write setup/build/migration commands, verifies local tests before submitting, and auto-debugs on failure (up to 5 attempts).

## Core Features

- **Workspace Context Probe & Contract Adherence:** Inspects `package.json`, installed dependencies, module type (`CommonJS` vs `ESM`), `.env`, and any existing test files inside the container before writing code.
- **Terminal-First Disk Writer (Zero Monaco Corruption):** Writes clean, comment-free files atomically via base64 shell scripts inside the integrated terminal so VS Code Web's Monaco buffers are never mangled.
- **Post-Write Setup & Auto-Remediation Commands:** Automatically executes required setup/migration/build/seed commands (`prisma db push`, `prisma generate`, `npm run build`, missing `npm install`, backtick commands from specs, or AI `// __commands__`).
- **Pre-Submit Verification Gate:** Runs syntax checking (`node --check`), local Mocha/Jest test suites (`npm test`), and safe startup smoke checks locally before clicking slow Remote Submit.
- **Priority-Preserving Debug Escalation:** Escalates failures to Gemini Pro / Groq fallback with priority-compacted failure diagnostics (keeping error traces & current code intact under strict TPM quotas) for up to 5 attempts.
- **Turbo Parallel AI Race Mode:** Races Groq (`openai/gpt-oss-120b` / `qwen/qwen3-32b`) & Gemini (`gemini-2.5-flash`) concurrently on Attempt 1.

## Modular Directory Structure

```
AP-Solver/
├── manifest.json              # Chrome Extension Manifest V3 configuration
├── background.js              # Slim MV3 service worker entry & message router
├── background/
│   ├── cdp.js                 # CDP native OS clicks, keys & Explorer targeting
│   ├── editor.js              # Cross-frame Monaco reader & manual inject fallback
│   ├── terminal.js            # Integrated terminal opener, MAIN-world buffer reader & writer
│   └── workspace.js           # Container probe, local test runner & setup command runner
├── utils/
│   ├── llm.js                 # Public barrel re-exporting utils modules
│   ├── code-format.js         # Comment stripping, 2-space indenting & multi-file parser
│   ├── commands.js            # Command sanitizer, extractor, remediation & base64 builder
│   ├── prompts.js             # Prompt assembly, context gating & priority TPM compaction
│   └── providers.js           # Gemini, Groq, OpenAI clients, Turbo Race & Debug Escalation
├── content/
│   ├── shared.js              # Shared DOM helpers, comment stripper & bash script builder
│   ├── dom-scrapers.js        # Question, Submissions (Tab 2) & Terminal Log (Tab 3) scrapers
│   ├── error-parser.js        # Mocha/Jest/ANSI/PENDING parser & debug feedback builder
│   ├── solver-ui.js           # Floating Newton Copilot glassmorphic panel
│   ├── content.js             # Core 6-step autonomous lifecycle orchestrator
│   ├── frame-editor.js        # All-frame editor & xterm terminal bridge controller
│   ├── main-world-bridge.js   # Page-world Monaco & xterm.buffer script bridge
│   └── styles.css             # Copilot styling
├── popup/                     # Quick extension popup controller
├── options/                   # Provider & model settings page
├── tests/                     # Modular unit & integration test suites
└── test_extension.js          # Single entrypoint running all test suites
```

## Verification

```bash
node test_extension.js
```
