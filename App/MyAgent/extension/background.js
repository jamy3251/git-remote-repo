// MyAgent Bridge - Background Service Worker
// Two-way bridge: reads AI conversations AND sends messages TO AI tabs

const DEFAULT_SERVER = "http://localhost:3456";
let serverUrl = DEFAULT_SERVER;

chrome.storage.local.get(["serverUrl"], (result) => {
  if (result.serverUrl) serverUrl = result.serverUrl;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.serverUrl) serverUrl = changes.serverUrl.newValue;
});

// Track AI tabs: tabId -> { agent, url }
const aiTabs = new Map();

// Detect AI tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  let agent = null;
  if (tab.url.includes("chatgpt.com") || tab.url.includes("chat.openai.com")) agent = "chatgpt";
  else if (tab.url.includes("gemini.google.com")) agent = "gemini";
  else if (tab.url.includes("perplexity.ai")) agent = "perplexity";
  else if (tab.url.includes("claude.ai")) agent = "claude-web";

  if (agent) {
    aiTabs.set(tabId, { agent, url: tab.url });
    notifyServer("tab_detected", { agent, tabId, url: tab.url });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (aiTabs.has(tabId)) {
    const { agent } = aiTabs.get(tabId);
    aiTabs.delete(tabId);
    notifyServer("tab_closed", { agent, tabId });
  }
});

// ============================================================
// Receive messages FROM content scripts (AI → server)
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "new_message") {
    sendToServer(msg.agent, msg.content, msg.role);
    sendResponse({ ok: true });
  } else if (msg.type === "suggestion") {
    sendSuggestion(msg.agent, msg.content);
    sendResponse({ ok: true });
  } else if (msg.type === "status_update") {
    updateAgentStatus(msg.agent, msg.status);
    sendResponse({ ok: true });
  } else if (msg.type === "conversation_sync") {
    syncConversation(msg.agent, msg.messages);
    sendResponse({ ok: true });
  } else if (msg.type === "get_server_url") {
    sendResponse({ serverUrl });
  }
  return true;
});

// ============================================================
// Send messages TO AI tabs (server → AI)
// ============================================================
function sendMessageToAgent(agentId, content) {
  // Find the tab for this agent
  for (const [tabId, info] of aiTabs) {
    if (info.agent === agentId) {
      chrome.tabs.sendMessage(tabId, { type: "send_to_ai", content }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[MyAgent] Failed to send to", agentId, ":", chrome.runtime.lastError.message);
        } else {
          console.log("[MyAgent] Sent to", agentId, ":", response?.ok);
        }
      });
      return true;
    }
  }
  console.warn("[MyAgent] No tab found for agent:", agentId);
  return false;
}

// ============================================================
// Poll server for pending relay commands (AI-to-AI)
// ============================================================
let pollInterval = null;

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${serverUrl}/api/relay/pending`);
      if (!res.ok) return;
      const commands = await res.json();

      for (const cmd of commands) {
        const sent = sendMessageToAgent(cmd.targetAgent, cmd.content);
        // Acknowledge
        await fetch(`${serverUrl}/api/relay/${cmd.id}/ack`, { method: "POST" });
        if (sent) {
          console.log(`[MyAgent Relay] ${cmd.sourceAgent} → ${cmd.targetAgent}: "${cmd.content.slice(0, 40)}..."`);
        }
      }
    } catch {
      // server not running, ok
    }
  }, 2000); // check every 2 seconds
}

// Start polling when extension loads
startPolling();

// ============================================================
// Server communication helpers
// ============================================================
async function sendToServer(agent, content, role) {
  try {
    await fetch(`${serverUrl}/api/extension/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent, content, role }),
    });
  } catch (e) {
    console.error("[MyAgent Bridge] Failed to send message:", e.message);
  }
}

async function updateAgentStatus(agent, status) {
  try {
    await fetch(`${serverUrl}/api/extension/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent, status }),
    });
  } catch (e) {}
}

async function sendSuggestion(agent, content) {
  try {
    await fetch(`${serverUrl}/api/extension/suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent, content }),
    });
  } catch (e) {}
}

async function syncConversation(agent, messages) {
  try {
    await fetch(`${serverUrl}/api/extension/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent, messages }),
    });
  } catch (e) {}
}

async function notifyServer(event, data) {
  try {
    await fetch(`${serverUrl}/api/extension/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...data }),
    });
  } catch (e) {}
}
