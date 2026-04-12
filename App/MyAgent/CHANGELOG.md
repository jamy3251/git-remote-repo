# Changelog

## v1.0.0 (2026-04-12)

Initial release of MyAgent Control Tower.

### Features
- Interactive pixel-art AI Cafe with walking characters
- 4 default agents: Claude, ChatGPT (red), Gemini, Perplexity
- Click characters to chat, drag to move around cafe
- Ace Attorney style chat UI with speech bubbles and "OBJECTION!" animation
- Real-time WebSocket sync between PC and phone
- Chrome extension (Manifest V3) for auto-capturing AI conversations
- Suggestion detection from AI follow-up prompts
- Agent type settings: Web LLM vs CLI Agent
- CLI auto-accept toggle for Claude Code / Codex
- Debate tables: drop AI characters on tables to set up topic debates
- Seoul real-time weather + time reflected in cafe window background
- Tunnel support (localtunnel / cloudflared) for phone access without WiFi
- PWA manifest for phone home screen install
- SQLite local database with deduplication
- Auto-create agents when unknown AI detected by extension
- Themed 404 error page (Ace Attorney style)
- 55 integration tests (all passing)

### Tech Stack
- React Router 7 + Express 5 + TypeScript
- WebSocket (ws) for real-time communication
- SQLite (better-sqlite3) for local storage
- Tailwind CSS v4 + DungGeunMo pixel font
- Open-Meteo API for weather (no API key needed)
