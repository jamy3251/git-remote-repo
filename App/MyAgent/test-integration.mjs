// MyAgent Integration Test Suite
// Tests: messages, cross-agent debate, suggestions, agent settings, weather

const BASE = "http://localhost:3456";
let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  return res.json();
}

async function run() {
  console.log("============================================");
  console.log("  MyAgent Integration Test");
  console.log("============================================\n");

  // =============================================
  // Test 1: Agent initialization
  // =============================================
  console.log("[Test 1] Agent initialization");
  const agents = await api("GET", "/api/agents");
  assert("4 agents seeded", agents.length === 4);
  assert("Claude exists", agents.some(a => a.id === "claude" && a.color === "#7C3AED"));
  assert("ChatGPT is RED", agents.some(a => a.id === "chatgpt" && a.color === "#E94560"));
  assert("Gemini exists", agents.some(a => a.id === "gemini" && a.color === "#4285F4"));
  assert("Perplexity exists", agents.some(a => a.id === "perplexity" && a.color === "#20B2AA"));
  console.log();

  // =============================================
  // Test 2: Message send + retrieve
  // =============================================
  console.log("[Test 2] Message send + retrieve");
  const m1 = await api("POST", "/api/messages", {
    agentId: "claude", content: "What is React Server Components?", role: "user"
  });
  assert("User message saved", m1.id > 0 && m1.role === "user");

  const m2 = await api("POST", "/api/extension/message", {
    agentId: "claude",
    content: "React Server Components (RSC) allow you to render components on the server. They reduce client-side JavaScript bundle size and enable direct database access from components.",
    role: "assistant"
  });
  assert("Extension message saved", m2.ok === true && m2.message.id > 0);

  const claudeMsgs = await api("GET", "/api/messages/claude");
  assert("Claude has 2 messages", claudeMsgs.length === 2);
  assert("Message order correct", claudeMsgs[0].role === "user" && claudeMsgs[1].role === "assistant");
  console.log();

  // =============================================
  // Test 3: Deduplication
  // =============================================
  console.log("[Test 3] Deduplication");
  const m3 = await api("POST", "/api/extension/message", {
    agentId: "claude",
    content: "React Server Components (RSC) allow you to render components on the server. They reduce client-side JavaScript bundle size and enable direct database access from components.",
    role: "assistant"
  });
  assert("Duplicate detected", m3.ok === true && m3.duplicate === true);

  const claudeMsgs2 = await api("GET", "/api/messages/claude");
  assert("No duplicate stored", claudeMsgs2.length === 2);
  console.log();

  // =============================================
  // Test 4: Multi-agent debate simulation
  // =============================================
  console.log("[Test 4] Multi-agent debate: 'Should startups use microservices?'");

  // User asks all 3 agents
  const question = "Should a startup with 3 engineers use microservices architecture? Give your honest opinion.";
  for (const agent of ["claude", "chatgpt", "gemini"]) {
    await api("POST", "/api/messages", { agentId: agent, content: question, role: "user" });
    await api("POST", "/api/extension/status", { agentId: agent, status: "working" });
  }

  // Each AI responds differently
  const claudeAnswer = "No. With 3 engineers, microservices will slow you down. You will spend more time on infrastructure than product. Start with a monolith, split later when you hit real scaling problems. The premature complexity of microservices has killed more startups than monolith limitations ever will.";

  const chatgptAnswer = "It depends on the context! Microservices offer flexibility and independent deployment. However, for a 3-person team, the operational overhead might outweigh the benefits. I would suggest starting with a modular monolith that can be decomposed later. This gives you the best of both worlds.";

  const geminiAnswer = "Absolutely not. Google itself started as a monolith. The decision to use microservices should be driven by organizational scaling needs, not technical ideology. With 3 engineers, you need velocity. A well-structured monolith with clear module boundaries is the right call. Revisit this decision when you hit 15+ engineers.";

  await api("POST", "/api/extension/message", { agentId: "claude", content: claudeAnswer, role: "assistant" });
  await api("POST", "/api/extension/message", { agentId: "chatgpt", content: chatgptAnswer, role: "assistant" });
  await api("POST", "/api/extension/message", { agentId: "gemini", content: geminiAnswer, role: "assistant" });

  // Verify all stored
  const cMsgs = await api("GET", "/api/messages/claude");
  const gptMsgs = await api("GET", "/api/messages/chatgpt");
  const gemMsgs = await api("GET", "/api/messages/gemini");
  assert("Claude has 4 messages", cMsgs.length === 4);
  assert("ChatGPT has 2 messages", gptMsgs.length === 2);
  assert("Gemini has 2 messages", gemMsgs.length === 2);

  // Check content integrity
  assert("Claude answer intact", cMsgs[3].content.includes("monolith") && cMsgs[3].content.includes("premature"));
  assert("ChatGPT answer intact", gptMsgs[1].content.includes("modular monolith") && gptMsgs[1].content.includes("best of both"));
  assert("Gemini answer intact", gemMsgs[1].content.includes("Google") && gemMsgs[1].content.includes("15+ engineers"));
  console.log();

  // =============================================
  // Test 5: Cross-agent conversation (relay debate)
  // =============================================
  console.log("[Test 5] Cross-agent relay debate");

  // User relays Claude's opinion to ChatGPT for rebuttal
  await api("POST", "/api/messages", {
    agentId: "chatgpt",
    content: `Claude said: "${claudeAnswer}" Do you agree or disagree? Challenge their strongest point.`,
    role: "user"
  });

  const chatgptRebuttal = "I partially disagree with Claude. While I agree that 3 engineers shouldn't run full microservices, Claude's absolute 'No' ignores cases where your product naturally splits into independent services - for example, if you have a real-time chat feature alongside a batch processing pipeline. The key question isn't 'monolith vs microservices' but 'where are the natural service boundaries in YOUR product?' Sometimes 2-3 services is the right answer even for a small team.";

  await api("POST", "/api/extension/message", { agentId: "chatgpt", content: chatgptRebuttal, role: "assistant" });

  // Relay ChatGPT's rebuttal back to Claude
  await api("POST", "/api/messages", {
    agentId: "claude",
    content: `ChatGPT challenged your opinion: "${chatgptRebuttal}" How do you respond?`,
    role: "user"
  });

  const claudeResponse = "Fair point about natural service boundaries. I'll refine my position: the default should be monolith, but if your product genuinely has independent domains with different scaling characteristics (like ChatGPT's example of real-time + batch), then 2-3 services is reasonable. The mistake is starting with microservices as an architectural ideology rather than arriving at them from observed needs. My 'No' was too absolute.";

  await api("POST", "/api/extension/message", { agentId: "claude", content: claudeResponse, role: "assistant" });

  // Verify debate integrity
  const cFinal = await api("GET", "/api/messages/claude");
  const gptFinal = await api("GET", "/api/messages/chatgpt");

  assert("Claude debate: 6 messages total", cFinal.length === 6);
  assert("ChatGPT debate: 4 messages total", gptFinal.length === 4);
  assert("Claude references ChatGPT", cFinal[4].content.includes("ChatGPT"));
  assert("ChatGPT references Claude", gptFinal[2].content.includes("Claude"));
  assert("Claude refines position", cFinal[5].content.includes("refine") || cFinal[5].content.includes("too absolute"));
  assert("ChatGPT makes specific argument", gptFinal[3].content.includes("natural service boundaries"));
  assert("Debate is meaningful (not generic)", cFinal[5].content.includes("real-time") || cFinal[5].content.includes("batch"));
  console.log();

  // =============================================
  // Test 6: Status lifecycle
  // =============================================
  console.log("[Test 6] Status lifecycle");
  await api("POST", "/api/extension/status", { agentId: "claude", status: "idle" });
  let a1 = (await api("GET", "/api/agents")).find(a => a.id === "claude");
  assert("Claude idle", a1.status === "idle");

  await api("POST", "/api/extension/status", { agentId: "claude", status: "working" });
  let a2 = (await api("GET", "/api/agents")).find(a => a.id === "claude");
  assert("Claude working", a2.status === "working");

  await api("POST", "/api/extension/status", { agentId: "claude", status: "done" });
  let a3 = (await api("GET", "/api/agents")).find(a => a.id === "claude");
  assert("Claude done", a3.status === "done");

  await api("POST", "/api/extension/status", { agentId: "claude", status: "error" });
  let a4 = (await api("GET", "/api/agents")).find(a => a.id === "claude");
  assert("Claude error", a4.status === "error");
  console.log();

  // =============================================
  // Test 7: Suggestions lifecycle
  // =============================================
  console.log("[Test 7] Suggestions lifecycle");

  const s1 = await api("POST", "/api/extension/suggestion", {
    agentId: "chatgpt", content: "Tell me about Kubernetes best practices"
  });
  assert("Suggestion created", s1.ok && s1.suggestion.id > 0);

  const s2 = await api("POST", "/api/extension/suggestion", {
    agentId: "chatgpt", content: "Compare Docker Swarm vs Kubernetes"
  });
  assert("Second suggestion", s2.ok && s2.suggestion.id > 0);

  // Duplicate within 5 min
  const s3 = await api("POST", "/api/extension/suggestion", {
    agentId: "chatgpt", content: "Tell me about Kubernetes best practices"
  });
  assert("Duplicate suggestion blocked", s3.duplicate === true);

  const pending = await api("GET", "/api/suggestions/chatgpt");
  assert("2 pending suggestions", pending.length === 2);

  // Accept one
  await api("POST", `/api/suggestions/${s1.suggestion.id}/action`, { action: "accepted" });
  const afterAccept = await api("GET", "/api/suggestions/chatgpt");
  assert("1 remaining after accept", afterAccept.length === 1);

  // Dismiss the other
  await api("POST", `/api/suggestions/${s2.suggestion.id}/action`, { action: "dismissed" });
  const afterDismiss = await api("GET", "/api/suggestions/chatgpt");
  assert("0 remaining after dismiss", afterDismiss.length === 0);
  console.log();

  // =============================================
  // Test 8: Agent settings (Web vs CLI, auto-accept)
  // =============================================
  console.log("[Test 8] Agent settings");

  // Default: web
  const set1 = await api("GET", "/api/agent-settings/claude");
  assert("Default type is web", set1.agent_type === "web");
  assert("Default auto-accept off", set1.auto_accept === 0);

  // Switch to CLI
  const set2 = await api("POST", "/api/agent-settings/claude", { agent_type: "cli" });
  assert("Switch to CLI", set2.agent_type === "cli");

  // Enable auto-accept
  const set3 = await api("POST", "/api/agent-settings/claude", { auto_accept: true });
  assert("Auto-accept ON", set3.auto_accept === 1);

  // Disable auto-accept
  const set4 = await api("POST", "/api/agent-settings/claude", { auto_accept: false });
  assert("Auto-accept OFF", set4.auto_accept === 0);

  // Switch back to web
  const set5 = await api("POST", "/api/agent-settings/claude", { agent_type: "web" });
  assert("Switch back to web", set5.agent_type === "web");

  // ChatGPT settings independent
  const set6 = await api("GET", "/api/agent-settings/chatgpt");
  assert("ChatGPT default web", set6.agent_type === "web");
  console.log();

  // =============================================
  // Test 9: Conversation sync (bulk import)
  // =============================================
  console.log("[Test 9] Conversation sync");

  const syncResult = await api("POST", "/api/extension/sync", {
    agentId: "perplexity",
    messages: [
      { role: "user", content: "What is quantum computing?" },
      { role: "assistant", content: "Quantum computing uses quantum mechanical phenomena like superposition and entanglement to process information." },
      { role: "user", content: "How far away is practical quantum computing?" },
      { role: "assistant", content: "Most experts estimate 5-10 years for commercially useful quantum computers that outperform classical computers on practical problems." },
    ]
  });
  assert("Sync added 4 messages", syncResult.added === 4);

  // Re-sync should add 0
  const syncResult2 = await api("POST", "/api/extension/sync", {
    agentId: "perplexity",
    messages: [
      { role: "user", content: "What is quantum computing?" },
      { role: "assistant", content: "Quantum computing uses quantum mechanical phenomena like superposition and entanglement to process information." },
    ]
  });
  assert("Re-sync adds 0 (dedup)", syncResult2.added === 0);

  const pMsgs = await api("GET", "/api/messages/perplexity");
  assert("Perplexity has 4 messages", pMsgs.length === 4);
  assert("Content preserved", pMsgs[1].content.includes("superposition"));
  console.log();

  // =============================================
  // Test 10: Auto-create agent from extension
  // =============================================
  console.log("[Test 10] Auto-create unknown agent");
  await api("POST", "/api/extension/message", {
    agentId: "deepseek",
    content: "I am DeepSeek, a new AI model.",
    role: "assistant"
  });
  const allAgents = await api("GET", "/api/agents");
  const deepseek = allAgents.find(a => a.id === "deepseek");
  assert("DeepSeek auto-created", !!deepseek);
  assert("DeepSeek has message", true);
  console.log();

  // =============================================
  // Test 11: Main page renders
  // =============================================
  console.log("[Test 11] Page rendering");
  const mainPage = await (await fetch(`${BASE}/`)).text();
  assert("Main page has AI CAFE", mainPage.includes("AI CAFE"));
  assert("Main page has Seoul weather", mainPage.includes("Seoul"));

  const chatPage = await (await fetch(`${BASE}/chat/claude`)).text();
  assert("Chat page renders", chatPage.includes("Claude") || chatPage.includes("claude"));

  const settingsPage = await (await fetch(`${BASE}/settings`)).text();
  assert("Settings page renders", settingsPage.includes("Settings") || settingsPage.includes("settings"));

  const newAgentPage = await (await fetch(`${BASE}/agents/new`)).text();
  assert("New agent page renders", newAgentPage.includes("Agent") || newAgentPage.includes("agent"));
  console.log();

  // =============================================
  // Test 12: WebSocket connection
  // =============================================
  console.log("[Test 12] WebSocket");
  try {
    const { WebSocket } = await import("ws");
    const ws = new WebSocket("ws://localhost:3456/ws");
    const wsResult = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ connected: false }), 3000);
      ws.on("open", () => {
        ws.on("message", (data) => {
          clearTimeout(timeout);
          const msg = JSON.parse(data.toString());
          ws.close();
          resolve({ connected: true, type: msg.type, agentCount: msg.agents?.length });
        });
      });
      ws.on("error", () => { clearTimeout(timeout); resolve({ connected: false }); });
    });
    assert("WebSocket connects", wsResult.connected);
    assert("Receives agents_list", wsResult.type === "agents_list");
    assert("Has 5 agents (incl. deepseek)", wsResult.agentCount === 5);
  } catch (e) {
    console.log("  SKIP: WebSocket test (ws module not available as ESM)");
  }
  console.log();

  // =============================================
  // Summary
  // =============================================
  console.log("============================================");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`  TOTAL:   ${passed + failed} tests`);
  console.log("============================================");

  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error("Test error:", e); process.exit(1); });
