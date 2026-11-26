# Changelog

All notable changes to Chat for Pi are recorded here. Versions follow [Semantic Versioning](https://semver.org/). New work goes under **Unreleased** before the next release.

## [Unreleased]

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
