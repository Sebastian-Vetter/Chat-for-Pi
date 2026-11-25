# Chat for Pi

A local, ChatGPT-style web workspace for the real Pi coding agent. Built with React, TypeScript, Vite, Express, and the Pi SDK.

Website: **[aptcode.de](https://aptcode.de)**

## How to install Pi

Already using Pi on this computer? Keep your existing installation and provider configuration; you do not need to reinstall it.

### 1. Install the Pi CLI

Pi requires **Node.js 22.19 or newer**. If Node.js is already installed, install the CLI with npm:

```sh
node --version
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi --version
```

Alternatively, the official installer can install Node.js if needed. On macOS or Linux:

```sh
curl -fsSL https://pi.dev/install.sh | sh
```

On Windows, use PowerShell:

```powershell
irm https://pi.dev/install.ps1 | iex
```

These installer commands download and execute a script. Review it first if you prefer, or use the npm installation above. See **[Pi's official documentation](https://pi.dev)** for installation and updates.

### 2. Connect your AI provider

Start Pi from a project directory:

```sh
cd /path/to/your/project
pi
```

Inside Pi, run **`/login`** and follow the prompts to connect a supported subscription or API key. Use **`/model`** to choose a model, then send a short message to check the connection. Provider usage may incur charges.

### 3. Start Chat

Follow the Run section below from this repository. Chat uses the Pi configuration and saved credentials for the same operating-system user; no API key needs to be pasted into the web interface. Restart Chat after changing provider credentials if the model list does not update.

## Run

Use Node.js 22.19 or newer. Run commands from this directory:

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

## Background server and Pi terminal command (macOS)

Install the command into your personal Pi extensions directory:

```sh
npm run pi:install
```

Then run **`/reload`** inside Pi. The following commands become available in any Pi workspace:

```text
/chat-server start
/chat-server status
/chat-server open
/chat-server logs
/chat-server restart
/chat-server stop
```

`start` builds the web app and registers a user-level **launchd** service. Open **http://127.0.0.1:3001**. The service, AI runs, local tests, and prompt queues are owned by the backend, not the terminal or browser tab. Closing Pi or Terminal does not stop them. The service also starts at your next macOS login. Logging out, restarting the Mac, sleep, or stopping the service can interrupt active work; this is not a remote always-on host.

**Stop an existing `npm run dev` / `npm start` API before starting the service.** The command refuses occupied ports and never kills an unrelated process. `stop` unloads only this project's service and removes automatic login startup; it preserves conversation data. Pi terminal conversations themselves are not transferred into the background process.

Equivalent shell commands are `npm run server:start`, `server:status`, `server:open`, `server:logs`, `server:restart`, and `server:stop`. After code updates, use `server:restart` to rebuild and reload the background app. `npm run pi:uninstall` removes only the terminal command; stop the service separately if desired. Reinstall the command after moving this checkout.

Logs are stored under `~/Library/Logs/Pi Chat/`. The command displays the exact directory. The launch agent is stored under `~/Library/LaunchAgents/de.aptcode.pi-chat.<project-id>.plist`. If macOS denies access to a project inside Documents, review the service's error log and grant the Node executable appropriate access in System Settings; no permissions are granted automatically. The service uses saved Pi credentials for your user. Provider API keys and terminal session variables are **not** copied into the launch agent; environment-only provider credentials must be configured in Pi's saved authentication instead.

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
- Existing Pi session browser, safe web copies, and independently running conversations
- Sequential prompt queues with remove, pause, and resume controls
- Clickable local Git change list and unified/full-context diff viewer
- Configured local test commands, live logs, stop controls, and run history
- Coding activity timeline and observable Thinking & activity progress panel
- AGENTS.md instructions in the left sidebar, including inherited context files
- Estimated context-window meter and saved last-run estimates
- Browser-local finish sounds: original EV-inspired tones or custom audio (up to 1 MB)
- Accessible animations and Reduce Motion support
- Small version label at the bottom-left, Settings, and Mac shortcut reference
- Enter to send/queue, ⇧↵ for a newline, ⌘K for a new chat, ⌘, for Settings, ⌘⇧E for workspace tools (Ctrl equivalents on other platforms)

Choose a workspace using the folder button **before sending a new conversation**. Existing conversations retain their original directory. The default is this project's parent directory (`coding`). A workspace path is validated when the conversation is created.

## Conversations, queues, and existing Pi sessions

Use **Browse existing Pi sessions** in the left sidebar to search saved CLI sessions across workspaces in Pi's configured default session storage. Sessions stored in a custom CLI `--session-dir` are not automatically discovered. Preview is read-only. **Continue as web conversation** forks an independent copy with its own session ID, keeping the original terminal history untouched. The original working directory must still exist to continue it.

Start a new conversation while another runs to work in parallel; sidebar spinners and the running-session count show background activity. Each conversation has a separate Pi session and prompt queue. They share your filesystem permissions, so choose separate workspaces or Git worktrees when concurrent edits could conflict.

While Pi works, enter more prompts and press **Queue** or Enter. Pending prompts run sequentially in that conversation. Remove individual items or pause/resume the queue. **Stop** pauses the queue as well as aborting the current response. Provider failures also pause it. After a backend restart, saved pending/in-flight prompts are recovered **paused** for review; retrying interrupted work may repeat changes already made before the interruption.

## Workspace tools

Click **Tools** in the header (⌘⇧E on Mac):

- **Changes:** shows all staged, unstaged, and untracked repository changes relative to HEAD, not just AI edits. Click a file to open its unified diff; enable Full file context for surrounding file contents. Git operations are read-only. Binary files are not rendered; new-file previews are limited to 1 MB and Git diff output to 2 MB.
- **Tests:** discovers non-watch package.json scripts named test/check/lint/typecheck/build (including colon variants), Cargo tests, Go tests, and configured pytest tests. Click Run explicitly. Commands execute on this Mac, not on GitHub Actions or GitLab CI. One local test run per workspace is allowed at a time. Logs retain their latest 64 KB.
- **Activity:** shows coding runs, finalized assistant responses, tool calls, and local test results, including durations and expandable arguments/output. The latest 300 events per conversation are retained. Earlier conversations are not backfilled. Thinking & activity shows **observable progress**, not private chain-of-thought.

The AGENTS.md section in the left sidebar uses Pi's own context discovery, including global, parent, and workspace instructions and Pi's fallback filenames. For active Pi sessions, the viewer shows the instructions actually loaded by that session; later edits on disk may differ until it reloads. Inactive sessions show discovery from disk. The context meter is an SDK estimate, not a billing token counter; a saved estimate is marked as such after restart.

## Settings and sounds

Open the Settings icon or press ⌘,. Enable Finish sound, choose EV arrival / EV success / Soft chime, adjust volume, or select a custom audio file up to 1 MB. These are original synthesized sounds, **not Tesla recordings**. Audio preferences and custom files stay in browser-local storage and are never uploaded. Finish sounds cover all app conversations in the current browser tab, not just the selected chat. Keep a tab open and click Preview sound if browser autoplay rules block audio; multiple open tabs may each play a notification. Private browsing or clearing browser storage removes these preferences.

## Data and safety

App-managed chat metadata, Pi JSONL sessions, activity, and prompt queues are saved in **`.data/`**, which is ignored by Git. They survive browser reloads and server restarts. To back up conversations, stop the app and copy `.data/`.

Deleting a chat removes its app-managed session history, not the files the agent created or changed in its workspace. Files are not automatically reverted when you delete a conversation or stop a response.

**This is a trusted, single-user local application, not a sandbox.** Pi can run shell commands and edit files with your user permissions, including outside the working directory. Requests are not gated by an additional per-tool approval dialog. Review changes and do not expose this app through a tunnel, public reverse proxy, or network interface. Loopback binding, host/origin validation, JSON-only mutations, and no cross-origin API access help protect the local service; they are not multi-user authentication.

Keep only one backend process per data directory. Transcripts and tool output can contain sensitive information. This version does not support file attachments, interactive session-tree navigation, hosted CI integrations, or multi-user access. Test commands and package scripts are executable code: run them only in trusted workspaces.

## Checks

```sh
npm test          # metadata, API, SSE, and transcript regression tests
npm run build     # strict TypeScript check and production frontend build
npx playwright install chromium
npm run test:e2e  # isolated desktop/mobile browser tests (ports 5174/13002)
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

Paths are resolved relative to the directory where the server starts. `CHAT_API_PORT` selects Vite's proxy target (default 3001), and `CHAT_WEB_PORT` selects its web port and the API's allowed development origin (default 5173). Browser tests use ports 5174/13002 and `.data/e2e/`, separately from your running app. The managed service uses fixed port 3001, this checkout's `.data/`, and this checkout's parent workspace.

## Versions and changelog

Versions started at **1.0.0**. The current version comes from `package.json` and is included in the frontend build, displayed at the bottom-left of the sidebar and in Settings. The UI therefore shows the newly built version after a browser refresh without requiring a backend restart just to update the label.

**Every shipped change gets a version bump and a matching [CHANGELOG.md](CHANGELOG.md) entry.** Use patch bumps by default, and choose minor/major bumps intentionally for feature/breaking releases. Add release notes under Unreleased before preparing each version:

```sh
npm run release -- patch   # Increment the current patch version
# Or: minor, major, or an explicit higher stable version such as 1.1.0
```

This updates package.json, package-lock.json, and the changelog together. It does not commit, tag, or push anything automatically. Review and commit the release as a small packet on `dev`.

## Layout

- `src/App.tsx` — conversations, live events, composer, workspace picker
- `src/styles.css` — responsive interface
- `server/index.ts` — local API, validation, SSE, production static hosting
- `server/agent.ts` — Pi lifecycle, session restoration, transcript projection
- `server/store.ts` — atomic chat metadata writes
- `server/git.ts`, `pipelines.ts`, `activity.ts` — read-only diffs, local tests, and event history
- `server/pi-sessions.ts`, `queue.ts` — Pi session discovery/import and durable prompt queues
- `src/Inspector.tsx`, `Instructions.tsx` — workspace panels and instruction viewer
- `src/Preferences.tsx`, `SessionStatus.tsx`, `ThinkingPanel.tsx` — sounds, context, queues, and progress
- `extensions/chat-server.ts`, `scripts/service.ts` — terminal command and macOS service lifecycle
- `scripts/release.ts`, `CHANGELOG.md` — version/release preparation and release notes
- `server/*.test.ts`, `scripts/*.test.ts`, `extensions/*.test.ts`, `tests/` — unit/API and browser checks

Work is recorded as small commits. The initial implementation commits are on `main`; the current working branch is `dev`. The repository currently has an `origin` remote at `https://github.com/Sebastian-Vetter/Chat-for-Pi.git`. No deployment is configured by this app.
