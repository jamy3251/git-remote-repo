// MyAgent Bridge - Gemini Content Script
// Monitors gemini.google.com for new messages

(() => {
  const AGENT_ID = "gemini";
  let isGenerating = false;
  const sentMessages = new Set();

  function hashText(text) {
    let h = 0;
    for (let i = 0; i < Math.min(text.length, 200); i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return `${h}_${text.length}`;
  }

  function getMessages() {
    const messages = [];

    // Gemini: user messages in .query-content or user-query, model in .model-response-text or response-content
    // Try multiple selector strategies

    // Strategy 1: conversation turns
    const turns = document.querySelectorAll("conversation-turn, .conversation-turn");
    for (const turn of turns) {
      const isUser = turn.querySelector(".user-query, .query-text, [data-turn-role='user']");
      const isModel = turn.querySelector(".model-response, .response-text, [data-turn-role='model']");

      if (isUser) {
        const text = isUser.innerText.trim();
        if (text) messages.push({ role: "user", content: text });
      }
      if (isModel) {
        const text = isModel.innerText.trim();
        if (text) messages.push({ role: "assistant", content: text });
      }
    }

    // Strategy 2: message-content elements
    if (messages.length === 0) {
      const userEls = document.querySelectorAll(".query-content, .user-query-text, [data-message-author='user']");
      const modelEls = document.querySelectorAll(".model-response-text, .response-container .markdown, [data-message-author='model']");

      userEls.forEach((el) => {
        const text = el.innerText.trim();
        if (text) messages.push({ role: "user", content: text });
      });
      modelEls.forEach((el) => {
        const text = el.innerText.trim();
        if (text) messages.push({ role: "assistant", content: text });
      });
    }

    // Strategy 3: generic approach - look for alternating message blocks
    if (messages.length === 0) {
      const allMessages = document.querySelectorAll("[class*='message'], [class*='Message'], [class*='turn'], [class*='Turn']");
      for (const el of allMessages) {
        const text = el.innerText.trim();
        if (!text || text.length < 2) continue;
        const className = el.className.toLowerCase();
        if (className.includes("user") || className.includes("query") || className.includes("human")) {
          messages.push({ role: "user", content: text });
        } else if (className.includes("model") || className.includes("response") || className.includes("assistant") || className.includes("bot")) {
          messages.push({ role: "assistant", content: text });
        }
      }
    }

    return messages;
  }

  function checkForNewMessages() {
    const messages = getMessages();
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

  // ========== SUGGESTION DETECTION ==========
  const sentSuggestions = new Set();
  function checkSuggestions() {
    // Gemini: suggestion chips appear as buttons below the response
    const selectors = [
      "suggestion-chip button", "suggestion-chip", "[class*='suggestion'] button",
      "[class*='chip'] button", "[class*='follow-up'] button",
      "button[class*='suggestion']", "button[class*='prompt']",
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = el.innerText.trim();
        if (text && text.length > 3 && text.length < 200) {
          const hash = hashText(text);
          if (!sentSuggestions.has(hash)) {
            sentSuggestions.add(hash);
            chrome.runtime.sendMessage({ type: "suggestion", agent: AGENT_ID, content: text });
          }
        }
      }
    }
  }

  function checkGenerationStatus() {
    const loading = document.querySelector(".loading-indicator, .thinking-indicator, [class*='loading'], mat-progress-bar, .response-streaming");
    const wasGenerating = isGenerating;
    isGenerating = !!loading;

    if (isGenerating && !wasGenerating) {
      chrome.runtime.sendMessage({ type: "status_update", agent: AGENT_ID, status: "working" });
    } else if (!isGenerating && wasGenerating) {
      chrome.runtime.sendMessage({ type: "status_update", agent: AGENT_ID, status: "done" });
      setTimeout(checkForNewMessages, 500);
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

  // ========== SEND MESSAGE TO AI ==========
  function sendToAI(text) {
    // Gemini: rich text editor or textarea
    const editor = document.querySelector(".ql-editor, [contenteditable='true'][aria-label*='prompt'], div[contenteditable='true'][role='textbox'], textarea[aria-label*='prompt']");
    if (!editor) { console.error("[MyAgent] Cannot find Gemini input"); return false; }

    editor.focus();
    if (editor.tagName === "TEXTAREA") {
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      nativeSet.call(editor, text);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      editor.innerHTML = `<p>${text}</p>`;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }

    setTimeout(() => {
      const sendBtn = document.querySelector("button[aria-label='Send message'], button.send-button, button[mat-icon-button][aria-label*='Send']");
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
      } else {
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      }
      console.log("[MyAgent] Message sent to Gemini");
    }, 300);
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "send_to_ai") { sendResponse({ ok: sendToAI(msg.content) }); }
    return true;
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(checkGenerationStatus, 1000);
    setTimeout(initialSync, 2000);
    console.log("[MyAgent Bridge] Gemini monitor active (send + receive)");
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
