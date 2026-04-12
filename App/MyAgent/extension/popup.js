const serverUrlInput = document.getElementById("serverUrl");
const saveBtn = document.getElementById("saveBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const connectionStatus = document.getElementById("connectionStatus");
const tabsList = document.getElementById("tabsList");

// Load saved URL
chrome.storage.local.get(["serverUrl"], (result) => {
  serverUrlInput.value = result.serverUrl || "http://localhost:3456";
  checkConnection(serverUrlInput.value);
});

// Save URL
saveBtn.addEventListener("click", () => {
  const url = serverUrlInput.value.replace(/\/$/, "");
  chrome.storage.local.set({ serverUrl: url });
  checkConnection(url);
});

// Check connection
async function checkConnection(url) {
  statusText.textContent = "Connecting...";
  statusDot.className = "dot yellow";
  connectionStatus.className = "status";

  try {
    const res = await fetch(`${url}/api/agents`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const agents = await res.json();
      statusText.textContent = `Connected (${agents.length} agents)`;
      statusDot.className = "dot green";
      connectionStatus.className = "status connected";
    } else {
      throw new Error("Bad response");
    }
  } catch {
    statusText.textContent = "Not connected";
    statusDot.className = "dot red";
    connectionStatus.className = "status disconnected";
  }
}

// List AI tabs
chrome.tabs.query({}, (tabs) => {
  const aiPatterns = [
    { pattern: /chatgpt\.com|chat\.openai\.com/, name: "ChatGPT", color: "#E94560" },
    { pattern: /gemini\.google\.com/, name: "Gemini", color: "#4285F4" },
    { pattern: /perplexity\.ai/, name: "Perplexity", color: "#20B2AA" },
    { pattern: /claude\.ai/, name: "Claude Web", color: "#7C3AED" },
  ];

  let foundAny = false;
  for (const tab of tabs) {
    if (!tab.url) continue;
    for (const ai of aiPatterns) {
      if (ai.pattern.test(tab.url)) {
        foundAny = true;
        const item = document.createElement("div");
        item.className = "tab-item";
        item.innerHTML = `
          <span class="dot green"></span>
          <span class="name" style="color:${ai.color}">${ai.name}</span>
          <span style="color:#666;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">${tab.title}</span>
        `;
        tabsList.appendChild(item);
      }
    }
  }

  if (!foundAny) {
    const item = document.createElement("div");
    item.className = "tab-item";
    item.style.color = "#666";
    item.textContent = "No AI tabs open";
    tabsList.appendChild(item);
  }
});
