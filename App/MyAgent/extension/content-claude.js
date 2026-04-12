// MyAgent Bridge - Claude Web Content Script
// Monitors claude.ai for new messages

(() => {
  const AGENT_ID = "claude-web";
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

    // Claude.ai: user and assistant message blocks
    const userMsgs = document.querySelectorAll("[data-testid='user-message'], .user-message, [class*='human-turn'], [class*='HumanTurn']");
    const assistantMsgs = document.querySelectorAll("[data-testid='assistant-message'], .assistant-message, [class*='ai-turn'], [class*='AssistantTurn']");

    if (userMsgs.length > 0 || assistantMsgs.length > 0) {
      // Interleave by DOM order
      const all = document.querySelectorAll("[data-testid='user-message'], [data-testid='assistant-message'], .user-message, .assistant-message, [class*='human-turn'], [class*='ai-turn']");
      for (const el of all) {
        const text = el.innerText.trim();
        if (!text) continue;
        const isUser = el.matches("[data-testid='user-message'], .user-message, [class*='human-turn'], [class*='HumanTurn']");
        messages.push({ role: isUser ? "user" : "assistant", content: text });
      }
    }

    // Fallback: prose blocks in conversation
    if (messages.length === 0) {
      const blocks = document.querySelectorAll("[class*='message'], [class*='Message']");
      for (const block of blocks) {
        const text = block.innerText.trim();
        if (!text || text.length < 5) continue;
        const className = (block.className || "").toLowerCase();
        if (className.includes("human") || className.includes("user")) {
          messages.push({ role: "user", content: text });
        } else if (className.includes("assistant") || className.includes("ai") || className.includes("claude")) {
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

  function checkGenerationStatus() {
    const loading = document.querySelector("[class*='stop'], [class*='Stop'], button[aria-label*='stop'], [class*='streaming']");
    const wasGenerating = isGenerating;
    isGenerating = !!loading;

    if (isGenerating && !wasGenerating) {
      chrome.runtime.sendMessage({ type: "status_update", agent: AGENT_ID, status: "working" });
    } else if (!isGenerating && wasGenerating) {
      chrome.runtime.sendMessage({ type: "status_update", agent: AGENT_ID, status: "done" });
      setTimeout(checkForNewMessages, 500);
    }
  }

  function initialSync() {
    const messages = getMessages();
    if (messages.length > 0) {
      for (const msg of messages) sentMessages.add(hashText(msg.content));
      chrome.runtime.sendMessage({ type: "conversation_sync", agent: AGENT_ID, messages });
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._debounce);
    observer._debounce = setTimeout(() => {
      checkForNewMessages();
      checkGenerationStatus();
    }, 300);
  });

  // ========== SEND MESSAGE TO AI ==========
  function sendToAI(text) {
    const editor = document.querySelector("div[contenteditable='true'][aria-label*='message'], div.ProseMirror[contenteditable='true'], textarea[placeholder*='Reply']");
    if (!editor) { console.error("[MyAgent] Cannot find Claude.ai input"); return false; }

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
      const sendBtn = document.querySelector("button[aria-label='Send Message'], button[aria-label='Send message'], button[type='submit']");
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
      } else {
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      }
      console.log("[MyAgent] Message sent to Claude.ai");
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
    console.log("[MyAgent Bridge] Claude.ai monitor active (send + receive)");
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
