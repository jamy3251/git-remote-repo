# MyAgent Control Tower

Ace Attorney style AI agent management dashboard. Monitor and control multiple AI assistants (ChatGPT, Claude, Gemini, Perplexity) from your phone via a pixel-art cafe interface.

No API keys required. Uses a Chrome extension to capture conversations from your existing AI web sessions in real-time.

## Features

- Pixel-art cafe scene where AI agents walk around as characters
- Click to chat, drag to move, drop on tables to start debates
- Real-time status monitoring (idle/working/done/error)
- Seoul weather + time reflected in the cafe window
- Chrome extension auto-captures AI conversations
- Suggestion detection from AI follow-up prompts
- CLI agent support with auto-accept toggle (Claude Code, Codex)
- WebSocket real-time sync between PC and phone
- PWA installable on phone home screen
- Tunnel support for phone access without shared WiFi

## Quickstart

```bash
# 1. Install
npm install

# 2. Build + Run
npm run build && npm start
```

The server prints two URLs:
- **Local:** http://localhost:3456 (PC browser)
- **Phone:** https://xxx.loca.lt (tunnel URL for phone, works over mobile data)

## Chrome Extension Setup

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder in this project
5. Click the extension icon to set the server URL

The extension auto-detects ChatGPT, Gemini, Perplexity, and Claude.ai tabs.

## Tech Stack

- React Router 7 + Express + TypeScript
- WebSocket (ws) for real-time communication
- SQLite (better-sqlite3) for local data storage
- Tailwind CSS + custom pixel-art theme (DungGeunMo font)
- localtunnel / cloudflared for phone tunneling
- Open-Meteo API for Seoul weather (no key needed)

## Project Structure

```
app/
  lib/db.server.ts          SQLite DB schema + queries
  lib/ws.client.ts          WebSocket client with auto-reconnect
  lib/weather.server.ts     Seoul real-time weather
  components/CafeScene.tsx  Interactive pixel cafe with furniture
  components/PixelCharacter.tsx  Animated AI character sprites
  components/ChatBubble.tsx Ace Attorney speech bubbles
  components/AgentCard.tsx  Agent status cards
  routes/home.tsx           Cafe dashboard
  routes/chat.$agentId.tsx  Chat view with suggestions + settings
  routes/agents.new.tsx     Add new agent
  routes/settings.tsx       TTS + connection settings
extension/                  Chrome extension (Manifest V3)
server.ts                   Express + WebSocket + tunnel server
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/agents | List all agents |
| GET | /api/messages/:agentId | Get chat history |
| POST | /api/messages | Send a message |
| POST | /api/extension/message | Chrome extension: new message |
| POST | /api/extension/status | Chrome extension: status change |
| POST | /api/extension/sync | Chrome extension: bulk sync |
| POST | /api/extension/suggestion | Chrome extension: detected suggestion |
| GET | /api/suggestions/:agentId | Get pending suggestions |
| POST | /api/suggestions/:id/action | Accept/dismiss suggestion |
| GET | /api/agent-settings/:agentId | Get agent config |
| POST | /api/agent-settings/:agentId | Update agent config (type, auto-accept) |

## Environment

- `PORT` - Server port (default: 3456)
- `NO_TUNNEL=1` - Disable automatic tunnel
