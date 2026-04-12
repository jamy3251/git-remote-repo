// MyAgent Bridge - ChatGPT Content Script
// Monitors chatgpt.com for messages + suggested prompts in real-time

(() => {
  const AGENT_ID = "chatgpt";
  let isGenerating = false;
  const sentMessages = new Set();
  const sentSuggestions = new Set();

  function hashText(text) {
    let h = 0;
    for (let i = 0; i < Math.min(text.length, 200); i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return `${h}_${text.length}`;
  }

  function getMessages() {
    const messages = [];
    const articles = document.querySelectorAll("article[data-testid^='conversation-turn']");
    for (const article of articles) {
      const userRole = article.querySelector("[data-message-author-role='user']");
      const assistantRole = article.querySelector("[data-message-author-role='assistant']");
      if (userRole) {
        const text = userRole.innerText.trim();
        if (text) messages.push({ role: "user", content: text });
      }
      if (assistantRole) {
        const text = assistantRole.innerText.trim();
        if (text) messages.push({ role: "assistant", content: text });
      }
    }
    if (messages.length === 0) {
      const turns = document.querySelectorAll("[data-message-author-role]");
      for (const turn of turns) {
        const role = turn.getAttribute("data-message-author-role");
        const text = turn.innerText.trim();
        if (text && (role === "user" || role === "assistant")) {
          messages.push({ role, content: text });
        }
      }
    }
    return messages;
  }

  // ========== SUGGESTION DETECTION ==========
  function getSuggestions() {
    const suggestions = [];

    // ChatGPT suggested prompts: buttons at the bottom of conversation
    // They appear as clickable chips/buttons after response completes
    const chipSelectors = [
      "button[class*='suggestion']",
      "button[class*='prompt']",
      "[data-testid*='suggestion']",
      "[data-testid*='prompt-suggestion']",
      // ChatGPT uses "prompt library" style chips
      ".flex.gap-2 button:not([aria-label])",
      // Follow-up suggestions at bottom
      "[class*='follow-up'] button",
      "[class*='FollowUp'] button",
    ];

    for (const sel of chipSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = el.innerText.trim();
        // Filter: must be text-like, not icons/single chars, not too long
        if (text && text.length > 3 && text.length < 200 && !text.match(/^[A-Z]$/)) {
          suggestions.push(text);
        }
      }
    }

    // Also check for "suggested replies" in a flex row near the input
    const inputArea = document.querySelector("form, [class*='composer']");
    if (inputArea) {
      const nearbyButtons = inputArea.querySelectorAll("button");
      for (const btn of nearbyButtons) {
        const text = btn.innerText.trim();
        if (text && text.length > 10 && text.length < 200 && !btn.querySelector("svg")) {
          suggestions.push(text);
        }
      }
    }

    return [...new Set(suggestions)]; // deduplicate
  }

  function checkSuggestions() {
    const suggestions = getSuggestions();
    for (const text of suggestions) {
      const hash = hashText(text);
      if (!sentSuggestions.has(hash)) {
        sentSuggestions.add(hash);
        chrome.runtime.sendMessage({
          type: "suggestion",
          agent: AGENT_ID,
          content: text,
        });
      }
    }
  }

  function checkForNewMessages() {
    const messages = getMessages();
    if (messages.length === 0) return;
    for (const msg of messages) {
      const hash = hashText(msg.content);
      if (!sentMessages.has(hash)) {
        sentMessages.add(hash);
        chrome.runtime.sendMessage({
          type: "new_message",
          agent: AGENT_ID,
          content: msg.content,
          role: msg.role,
        });
      }
    }
  }

  function checkGenerationStatus() {
    const stopButton = document.querySelector("button[aria-label='Stop generating']") ||
                       document.querySelector("button[data-testid='stop-button']") ||
                       document.querySelector("button.btn-neutral svg.animate-spin")?.closest("button");
    const wasGenerating = isGenerating;
    isGenerating = !!stopButton;

    if (isGenerating && !wasGenerating) {
      chrome.runtime.sendMessage({ type: "status_update", agent: AGENT_ID, status: "working" });
    } else if (!isGenerating && wasGenerating) {
      chrome.runtime.sendMessage({ type: "status_update", agent: AGENT_ID, status: "done" });
      setTimeout(checkForNewMessages, 500);
      // Check for suggestions after generation completes
      setTimeout(checkSuggestions, 1000);
    }
  }

  function initialSync() {
    const messages = getMessages();
    if (messages.length > 0) {
      for (const msg of messages) sentMessages.add(hashText(msg.content));
      chrome.runtime.sendMessage({ type: "conversation_sync", agent: AGENT_ID, messages });
    }
    setTimeout(checkSuggestions, 500);
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._debounce);
    observer._debounce = setTimeout(() => {
      checkForNewMessages();
      checkGenerationStatus();
      checkSuggestions();
    }, 300);
  });

  // ========== SEND MESSAGE TO AI (inject + click send) ==========
  function sendToAI(text) {
    // ChatGPT: find the textarea/contenteditable, set value, dispatch input, click send
    const textarea = document.querySelector("#prompt-textarea, textarea[data-id='root'], div[contenteditable='true'][id='prompt-textarea']");
    if (!textarea) { console.error("[MyAgent] Cannot find ChatGPT input"); return false; }

    // Focus and set value
    textarea.focus();
    if (textarea.tagName === "TEXTAREA") {
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      nativeSet.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // contenteditable div (newer ChatGPT UI)
      textarea.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = text;
      textarea.appendChild(p);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Click send button after a short delay (UI needs time to enable the button)
    setTimeout(() => {
      const sendBtn = document.querySelector("button[data-testid='send-button'], form button[type='submit'], button[aria-label='Send prompt']");
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        console.log("[MyAgent] Message sent to ChatGPT");
      } else {
        // Fallback: press Enter
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        console.log("[MyAgent] Message sent via Enter key");
      }
    }, 300);
    return true;
  }

  // Listen for send commands from background script
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "send_to_ai") {
      const ok = sendToAI(msg.content);
      sendResponse({ ok });
    }
    return true;
  });

  function start() {
    const chatContainer = document.querySelector("main") || document.body;
    observer.observe(chatContainer, { childList: true, subtree: true, characterData: true });
    setInterval(checkGenerationStatus, 1000);
    setTimeout(initialSync, 2000);
    console.log("[MyAgent Bridge] ChatGPT monitor active (send + receive)");
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
