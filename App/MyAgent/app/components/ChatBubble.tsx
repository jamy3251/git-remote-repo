import type { Message, Agent } from "~/lib/db.server";

const OBJECTION_KEYWORDS = [
  "하지만", "그러나", "이의", "반박", "아닙니다",
  "틀렸", "잘못", "However", "But", "actually",
  "disagree", "incorrect", "wrong", "Objection",
];

function hasObjection(content: string): boolean {
  return OBJECTION_KEYWORDS.some((kw) =>
    content.toLowerCase().includes(kw.toLowerCase())
  );
}

export function ChatBubble({
  message,
  agent,
  isNew,
}: {
  message: Message;
  agent: Agent;
  isNew?: boolean;
}) {
  const isAssistant = message.role === "assistant";
  const showObjection = isAssistant && hasObjection(message.content) && isNew;

  return (
    <div className={`mb-4 ${isNew ? (isAssistant ? "slide-in-left" : "slide-in-right") : ""}`}>
      {showObjection && (
        <div className="objection mb-2">
          !! OBJECTION !!
        </div>
      )}

      <div className="flex items-start gap-3">
        {isAssistant && (
          <div
            className="agent-avatar shrink-0"
            style={{
              borderColor: agent.color,
              color: agent.color,
              width: 48,
              height: 48,
              fontSize: 20,
            }}
          >
            {agent.name[0]}
          </div>
        )}

        <div className={`flex-1 ${!isAssistant ? "text-right" : ""}`}>
          <div
            className="text-xs mb-1"
            style={{ color: isAssistant ? agent.color : "#6366f1" }}
          >
            {isAssistant ? agent.name : "YOU"}
          </div>

          <div
            className={`speech-bubble ${
              isAssistant ? "assistant-bubble" : "user-bubble"
            } ${showObjection ? "screen-shake" : ""}`}
            style={
              isAssistant
                ? { borderColor: agent.color }
                : {}
            }
          >
            <div className={isNew ? "typing-text" : ""}>
              {message.content.split("\n").map((line, i) => (
                <span key={i}>
                  {line}
                  {i < message.content.split("\n").length - 1 && <br />}
                </span>
              ))}
            </div>
          </div>

          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {new Date(message.created_at + "Z").toLocaleTimeString()}
          </div>
        </div>

        {!isAssistant && (
          <div
            className="agent-avatar shrink-0"
            style={{
              borderColor: "#6366f1",
              color: "#6366f1",
              width: 48,
              height: 48,
              fontSize: 20,
            }}
          >
            U
          </div>
        )}
      </div>
    </div>
  );
}
