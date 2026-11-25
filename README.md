# Chat for Pi

A local, ChatGPT-style web workspace for the real Pi coding agent. Built with React, TypeScript, Vite, Express, and the Pi SDK.

## Run

Use Node.js 22 or newer. Run commands from this directory:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 3001. Both servers bind only to loopback.

For a production build served by a single local process:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Do not run the development API and production server simultaneously on the same port.

## Pi connection

The backend uses `@earendil-works/pi-coding-agent` directly, including your existing Pi provider credentials and default model settings. It does not copy credentials into the repository or send them to the browser. If no models are available, configure a provider using the Pi CLI first, then restart the app. Provider calls use your account and may incur charges.

Terminal-only extensions, skills, prompt templates, themes, and MCP integrations are intentionally disabled in this first web host. Standard Pi tools and workspace context discovery are available. The app does not execute the Pi CLI as a subprocess.

## Included

- Persistent conversations with their own Pi session and working directory
- Live assistant text, tool output, busy indicators, and stop controls
- Search, rename, delete, and reopen conversations
- Model picker using providers available in your Pi configuration
- Markdown, fenced code, tables, and copy-message controls
- Responsive dark interface and mobile sidebar
- Workspace directory picker (enter an absolute path or `~/...`)
- Enter to send, Shift+Enter for a newline, Cmd/Ctrl+K for a new chat

Choose a workspace using the folder button **before sending a new conversation**. Existing conversations retain their original directory. The default is this project's parent directory (`coding`). A workspace path is validated when the conversation is created.

## Data and safety

App-managed chat metadata and Pi JSONL sessions are saved in **`.data/`**, which is ignored by Git. They survive browser reloads and server restarts. This version shows conversations created in Chat; it does not import your existing CLI session history. To back up conversations, stop the app and copy `.data/`.

Deleting a chat removes its app-managed session history, not the files the agent created or changed in its workspace. Files are not automatically reverted when you delete a conversation or stop a response.

**This is a trusted, single-user local application, not a sandbox.** Pi can run shell commands and edit files with your user permissions, including outside the working directory. Requests are not gated by an additional per-tool approval dialog. Review changes and do not expose this app through a tunnel, public reverse proxy, or network interface. Loopback binding, host/origin validation, JSON-only mutations, and no cross-origin API access help protect the local service; they are not multi-user authentication.

Keep only one backend process per data directory. Transcripts and tool output can contain sensitive information. This version does not support file attachments, session branching, importing CLI sessions, or multi-user access.

## Checks

```sh
npm test          # metadata, API, SSE, and transcript regression tests
npm run build     # strict TypeScript check and production frontend build
npx playwright install chromium
npm run test:e2e  # desktop/mobile browser tests; starts dev servers if necessary
```

To use an existing Chrome installation instead of Playwright's Chromium on macOS:

```sh
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e
```

An opt-in real-provider test sends a short prompt and reopens the conversation. It may incur API costs:

```sh
PI_CHAT_LIVE=1 npm run test:e2e
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_DATA_DIR` | `.data` | Backend storage directory |
| `CHAT_WORKSPACE` | `..` | Initial working directory for new conversations |
| `PORT` | `3001` | Backend/production HTTP port |
| `CHROME_PATH` | unset | Optional browser executable for tests |

Paths are resolved relative to the directory where the server starts. Vite's development proxy targets port 3001; keep that default in development unless you also update `vite.config.ts`.

## Layout

- `src/App.tsx` — conversations, live events, composer, workspace picker
- `src/styles.css` — responsive interface
- `server/index.ts` — local API, validation, SSE, production static hosting
- `server/agent.ts` — Pi lifecycle, session restoration, transcript projection
- `server/store.ts` — atomic chat metadata writes
- `server/*.test.ts`, `tests/` — unit/API and browser checks

Work is recorded as small commits on `main`. No GitLab remote or deployment is configured yet.
