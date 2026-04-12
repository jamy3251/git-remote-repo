// MyAgent Bridge - Perplexity Content Script
// Monitors perplexity.ai for new messages

(() => {
  const AGENT_ID = "perplexity";
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

    // Perplexity: query blocks and answer blocks
    // User queries
    const queries = document.querySelectorAll("[class*='UserQuery'], [class*='query-text'], .prose.query, [data-testid='user-query']");
    // Answer blocks
    const answers = document.querySelectorAll("[class*='AnswerBlock'], [class*='answer-text'], .prose.answer, [data-testid='answer-content'], .markdown-answer");

    if (queries.length > 0 || answers.length > 0) {
      queries.forEach((el) => {
        const text = el.innerText.trim();
        if (text) messages.push({ role: "user", content: text });
      });
      answers.forEach((el) => {
        const text = el.innerText.trim();
        if (text && text.length > 10) messages.push({ role: "assistant", content: text });
      });
    }

    // Fallback: thread items
    if (messages.length === 0) {
      const threadItems = document.querySelectorAll("[class*='ThreadItem'], [class*='thread-item']");
      for (const item of threadItems) {
        // Check if it contains a query or answer
        const queryEl = item.querySelector("textarea, [contenteditable], [class*='query'], [class*='Query']");
        const answerEl = item.querySelector("[class*='answer'], [class*='Answer'], [class*='markdown'], .prose");

        if (queryEl) {
          const text = queryEl.innerText.trim() || queryEl.value?.trim();
          if (text) messages.push({ role: "user", content: text });
        }
        if (answerEl) {
          const text = answerEl.innerText.trim();
          if (text && text.length > 10) messages.push({ role: "assistant", content: text });
        }
      }
    }

    // Strategy 3: look for rich text content blocks
    if (messages.length === 0) {
      const blocks = document.querySelectorAll(".prose, [class*='rich-text'], [class*='RichText']");
      for (const block of blocks) {
        const text = block.innerText.trim();
        if (text && text.length > 20) {
          // Heuristic: if it has citations or sources, it's likely an answer
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
    // Perplexity: "Related" questions, follow-up suggestions
    const selectors = [
      "[class*='related'] button", "[class*='Related'] a", "[class*='suggestion'] button",
      "[class*='follow-up'] button", "[class*='FollowUp'] button",
      "button[class*='related']", "a[class*='related-question']",
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = el.innerText.trim();
        if (text && text.length > 5 && text.length < 200) {
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
    const loading = document.querySelector("[class*='loading'], [class*='Loading'], [class*='streaming'], .animate-pulse, [class*='generating']");
    const wasGenerating = isGenerating;
    isGenerating = !!loading;

    if (isGenerating && !wasGenerating) {
      chrome.runtime.sendMessage({ type: "status_update", agent: AGENT_ID, status: "working" });
    } else if (!isGenerating && wasGenerating) {
      chrome.runtime.sendMessage({ type: "status_update", agent: AGENT_ID, status: "done" });
      setTimeout(checkForNewMessages, 800);
      setTimeout(checkSuggestions, 1200);
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
    const textarea = document.querySelector("textarea[placeholder*='Ask'], textarea[placeholder*='ask'], textarea[aria-label*='Search'], textarea");
    if (!textarea) { console.error("[MyAgent] Cannot find Perplexity input"); return false; }

    textarea.focus();
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    nativeSet.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    setTimeout(() => {
      const sendBtn = textarea.closest("form")?.querySelector("button[type='submit'], button[aria-label*='Submit'], button[aria-label*='send']");
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
      } else {
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      }
      console.log("[MyAgent] Message sent to Perplexity");
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
    console.log("[MyAgent Bridge] Perplexity monitor active (send + receive)");
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
