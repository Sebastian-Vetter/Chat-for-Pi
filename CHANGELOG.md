# Changelog

All notable changes to Chat for Pi are recorded here. Versions follow [Semantic Versioning](https://semver.org/). New work goes under **Unreleased** before the next release.

## [Unreleased]

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
