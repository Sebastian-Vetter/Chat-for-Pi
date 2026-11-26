# Changelog

All notable changes to Chat for Pi are recorded here. Versions follow [Semantic Versioning](https://semver.org/). New work goes under **Unreleased** before the next release.

## [Unreleased]

## [1.1.4] - 2026-11-26

### Changed

- Removed the Commands / button below the composer for a quieter interface. The command reference remains accessible through `/help` and the searchable command palette; command behavior is unchanged.

### Tests

- Verified the removed button stays absent and that the command reference opens from the keyboard-driven palette and `/help`.

## [1.1.3] - 2026-11-26

### Changed

- Replaced competing task-plan and prompt-queue blocks with one quiet status row showing plan progress, queue count, and paused state. Details start closed and open only on request in a shared, scrollable overlay: one view at a time without shrinking the transcript or composer. Live updates never auto-open it.
- Switching views preserves unsent task-step drafts. Escape, the close icon, outside clicks, and moving focus elsewhere dismiss details; explicit dismissal restores summary-button focus. Plan editing, queue execution/controls, and existing approval gates remain unchanged.

### Tests

- Desktop/mobile regressions cover long plans and queues together, unchanged transcript bounds, bounded internal scrolling, draft preservation, live updates, keyboard/modal interactions, dismissal, reload defaults, and short mobile viewports. Existing reordering and approval tests exercise the new panel without provider calls.

## [1.1.2] - 2026-11-26

### Changed

- Simplified the conversation toolbar: removed Templates, Usage limits, and Require approvals controls, along with template/usage command-palette entries and dialogs. Template shortcuts are no longer expanded, and the interface makes no subscription-limit requests. Existing browser storage and conversation data are preserved.
- Chat and selected-response exports use small, subdued icons at the edge of the toolbar, without visible button text. Tooltips, accessible labels, keyboard activation, and touch-sized hit targets remain available.
- Existing approval-enabled conversations retain their backend protections and pending approval proposals; removing the switch does not silently authorize gated execution.

### Tests

- Updated desktop/mobile interface and palette regressions for removed controls and legacy templates, verified no usage checks, and retained real approval-gating and Markdown download coverage, including keyboard activation of icon-only exports.

## [1.1.1] - 2026-11-26

### Added

- Drag-and-drop grips and accessible up/down buttons reorder pending task-plan steps, including while Pi or configured tests are active. Running and completed steps keep their exact positions. Pending steps can also be added during active work; status changes/removal remain idle-only, and the plan does not start or enqueue prompts.
- Persisted plan revisions protect browser edits and model updates from overwriting newer changes. Stale operations fail with a review/retry message, live changes cancel an in-progress drag, and Pi must reread the current revision before replacing an existing plan. Reordering preserves unsent step text and keyboard focus.

### Tests

- Added plan operation, revision persistence, and stale-model-update tests plus API validation/origin checks. Desktop/mobile browser tests cover real pending work, native dragging, keyboard/button movement, fixed running/done positions, draft preservation, reloads, concurrent tabs, and mid-drag updates without provider calls.

## [1.1.0] - 2026-11-26

### Added

- A jump-to-latest button with a new-reply hint while reading older messages; clicking it resumes automatic following without interrupting manual scrolling.
- Persistent pinned conversations, custom folders, and browser-persisted grouping by recency, workspace project, or folder. Sidebar actions no longer cover conversation titles.
- Public pending/running/done task checklists, editable while idle and readable/updatable by Pi through an explicit `update_plan` tool. No private reasoning channels are used.
- Markdown downloads for complete visible conversations or selected assistant responses, with safely fenced tool output and no hidden-thinking export.
- Editable browser-local prompt templates, built-in review/debug/test shortcuts, and a searchable keyboard-accessible command palette for chats, projects, models, templates, and actions. Cmd/Ctrl K opens the palette; Cmd/Ctrl Shift N starts a new chat.
- Opt-in per-conversation execution approvals that gate the actual write/edit/bash/PowerShell implementations and configured-test process spawning. Full proposals require a one-shot, chat-scoped decision; cancellation, expiry, shutdown, audit failures, and replayed decisions fail closed. Denied agent actions pause the prompt queue. This remains trusted local execution, not a sandbox or rollback system.
- Explicit subscription-usage checks for OpenAI Codex/ChatGPT and Anthropic/Claude OAuth accounts: provider-reported 5-hour/weekly percentages and reset times, with honest unavailable/unsupported states. Checks use fixed endpoints, server-only credentials, bounded responses, deadlines, coalescing, a one-minute cache, and a `CHAT_USAGE_CHECK=0` opt-out. No inference prompts are sent.

### Tests

- Added approval tests covering real SDK overrides, writes/edits, denied shells, configured tests, cancellation, timeouts, audit failures, cross-chat decisions, replay protection, and persistent plans. Added quota metadata/parser/privacy tests and Markdown/template regression tests.
- Added desktop/mobile workflow, download, quota, command-palette, and jump-button coverage without live-provider calls. Browser tests disable real usage checks and use unique chat fixtures.

## [1.0.7] - 2026-11-26

### Fixed

- Conversations now open at the latest content and keep following streamed replies, activity-only runs, delayed image/font layout changes, and viewport resizing. Layout-generated scroll events no longer accidentally disable automatic following.
- Scrolling upward with the wheel, touch, keyboard, or scrollbar pauses automatic following so older messages remain readable. Returning to the bottom resumes following; opening another conversation or sending a message returns to the latest content.

### Tests

- Added desktop/mobile browser regression coverage for initial opening, reloads, conversation switching, streaming, delayed images, resizing, upward-scroll intent, and resuming automatic following. Tests use simulated conversation events without live-provider calls.

## [1.0.6] - 2026-11-25

### Changed

- Applied consistent, readable formatting across TypeScript, React, CSS, tests, and configuration. Added reusable formatter/typecheck commands, unused-code checks, and release-workflow quality checks.
- Split message rendering, welcome prompts, workspace selection, and session-list presentation out of the main app while preserving sidebar state and existing interactions. Removed repeated stop-request and derived-state logic.
- Consolidated release URLs, stable-version validation, artifact names, and Pi install commands into one shared module. Separated bounded process execution from macOS service management.
- Restructured update checking into bounded response reading, metadata validation, cache policy, and fetch/error handling; replaced untyped external metadata with explicit unknown-value validation.
- Replaced the distribution extension's long conditional dispatcher with focused command handlers, and split packaging into named preparation, archive, checksum, and release-note steps. Existing confirmations, data isolation, and opt-out behavior are preserved.

### Fixed

- Ordinary prompts such as `constructor` and `toString` no longer collide with inherited object properties in the web command dispatcher. Regression coverage intercepts submissions without making provider calls.

### Tests

- Added regression coverage for shared release metadata and shell-free process execution. Included formatter configuration in standalone application packages and documented the development quality workflow.

## [1.0.5] - 2026-11-25

### Added

- Installable Pi package manifest and a dependency-free distribution extension with confirmed `/chat-server install` and `/chat-server updates` commands. Managed application/data paths are independent of Pi's package cache; updates stage and build before switching, preserve sessions, and retain rollback code without automatically stopping services.
- Release packaging with Pi-package and standalone-app downloads, SHA-256 checksums, release notes, and an isolated clean-install verification command. A version-tagged GitHub Actions workflow tests and publishes GitHub Release assets; npm registry publication is not required.
- Automatic hourly public stable-release checks, an available-version banner, release notes/downloads and explicit update instructions under Settings → Updates & releases. Checks have timeouts, caching, rate limiting, offline/error states, and an opt-out; no prompts, workspace paths, or credentials are sent.
- Regression tests for update metadata validation, cache/rate limits, installer data preservation and failures, API safety, and desktop/mobile update notices. Tests disable real online release checks and live-provider calls remain opt-in. Browser workers are capped at two for reliable release verification, and archive fixtures use unique titles and wait for the rendered app.

## [1.0.4] - 2026-11-25

### Added

- Persistent session archive with sidebar browsing and restore controls, preserving conversation history, workspace files, and active runs.
- Hide/Show session list control with a browser-persisted preference, replacing the “Your conversations” heading.
- Archive API validation, persistence checks, and desktop/mobile archive/restore and list-visibility regression tests.

## [1.0.3] - 2026-11-25

### Documentation

- Added the repository's exact clone URL, explicit `dev` branch checkout, and fast-forward-only pull instructions, with dependency installation and restart guidance.

## [1.0.2] - 2026-11-25

### Added

- Opt-in `/subagent` research delegation using independent read-only Pi sessions, inherited model selection, bounded concurrency and runtime, parent cancellation, and persistent task/progress/result cards.
- Discoverable web command menu with subagent activation, compaction, model and thinking controls, and web shortcuts for settings, session import, workspace tools, new chats, and stop. Unsupported terminal commands are explicitly rejected; TUI-only integrations remain disabled.
- Offline regression coverage for delegation lifecycle, command activation, and browser command discovery. Browser tests now wait for API health before starting, avoiding frontend/API startup races.

## [1.0.1] - 2026-11-25

### Changed

- Established a version bump and changelog entry for every shipped change. UI labels and browser tests now use the package version directly, keeping refreshed frontend releases independent of a running backend’s cached version.
- Pinned the prompt queue below the chat header so it stays visible while the transcript scrolls. Hide/Show collapses it to a compact count/status bar, with the preference remembered in this browser and no change to queue execution.
- Moved Thinking & activity into the conversation transcript, including when a run has not produced its first message yet.
- Replaced the visible “Pi is working” status line with a left-to-right light flowing along the composer’s bottom border. Reduce Motion uses a static highlight; screen readers retain a working-status announcement.

### Fixed

- Finish sounds now default to enabled and play automatically after an AI response finishes. Explicitly disabled settings remain respected.
- Blocked browser audio now shows a notice with an Audio settings action instead of silently dropping the completion chime.

## [1.0.0] - 2026-11-25

### Added

- Local ChatGPT-style interface backed by the Pi SDK, with persistent conversations, streaming responses, Markdown, and tool output.
- Multiple independently running conversations with sidebar status indicators and per-conversation drafts.
- Existing Pi session browser with read-only previews and safe continuation into independent web sessions.
- Durable, sequential prompt queues with remove, pause, and resume controls. Stop pauses the queue; saved queues require confirmation after a server restart.
- Workspace tools: clickable Git change list, unified diff window, optional full-file context, and new-file previews.
- Configured local test discovery, explicit run/stop controls, streamed output, and persistent run results.
- Activity timeline for coding runs, assistant responses, tool calls, and local tests.
- Conversation-specific AGENTS.md sidebar with global/parent/workspace scopes and a read-only Markdown/source viewer.
- Estimated context-window meter, saved last-run context estimates, and Mac shortcut reference.
- Browser settings for finish sounds: original EV-inspired arrival/success tones, soft chime, volume, and optional custom audio.
- macOS Pi `/chat-server` command and user-level launchd service, independent of the terminal window.
- Accessible entrance animations and hover transitions, respecting Reduce Motion.
- Version display in the bottom-left sidebar, semantic release preparation command, and this changelog.
- Pi installation guide and [aptcode.de](https://aptcode.de) link.
- Unit/API and desktop/mobile browser regression tests, including an opt-in real-provider smoke test.

### Security and limitations

- Loopback-only server, host/origin validation, JSON-only mutations, read-only Git endpoints, and server-validated test task IDs.
- Web sessions use trusted local user permissions, not a sandbox. Terminal extensions are disabled in SDK sessions; the terminal command only manages the background service.
- Local pipelines are local test commands, not hosted GitHub Actions or GitLab CI jobs. Diffs describe all repository changes, not exclusively AI-authored edits.
- Finish sounds need an open browser tab and may require a user gesture. They are original synthesized sounds, not Tesla recordings.
