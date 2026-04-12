import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "Settings - MyAgent" }];
}

export default function Settings() {
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsVoice, setTtsVoice] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Load available voices
  if (typeof window !== "undefined" && voices.length === 0) {
    const loadVoices = () => {
      const v = speechSynthesis.getVoices();
      if (v.length > 0) setVoices(v);
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  function testTts() {
    if (!("speechSynthesis" in window)) {
      alert("TTS is not supported in this browser.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance("Objection! This is a test.");
    if (ttsVoice) {
      const voice = voices.find((v) => v.name === ttsVoice);
      if (voice) utterance.voice = voice;
    }
    speechSynthesis.speak(utterance);
  }

  return (
    <div className="courtroom-bg scanlines min-h-dvh">
      <header
        className="pixel-card m-0 p-4 flex items-center gap-3"
        style={{ borderLeft: "none", borderRight: "none", borderTop: "none" }}
      >
        <Link to="/" className="pixel-btn text-xs py-1 px-3 no-underline">
          Back
        </Link>
        <h1 className="text-lg crt-glow" style={{ color: "var(--accent-gold)" }}>
          Settings
        </h1>
      </header>

      <div className="p-4 space-y-6">
        {/* TTS Settings */}
        <div className="pixel-card p-4">
          <h2 className="text-base mb-3" style={{ color: "var(--accent-gold)" }}>
            Voice (TTS)
          </h2>

          <label className="flex items-center gap-3 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={ttsEnabled}
              onChange={(e) => setTtsEnabled(e.target.checked)}
              className="w-5 h-5"
            />
            <span>Enable Text-to-Speech for AI responses</span>
          </label>

          {ttsEnabled && (
            <>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                className="pixel-input mb-3"
              >
                <option value="">Default Voice</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>

              <button onClick={testTts} className="pixel-btn text-sm">
                Test Voice
              </button>
            </>
          )}
        </div>

        {/* About */}
        <div className="pixel-card p-4">
          <h2 className="text-base mb-3" style={{ color: "var(--accent-gold)" }}>
            About
          </h2>
          <div className="text-sm space-y-1" style={{ color: "var(--text-muted)" }}>
            <p>MyAgent Control Tower v1.0</p>
            <p>Ace Attorney style AI management dashboard</p>
            <p>No API keys required - paste AI responses manually</p>
          </div>
        </div>

        {/* Connection Info */}
        <div className="pixel-card p-4">
          <h2 className="text-base mb-3" style={{ color: "var(--accent-gold)" }}>
            Connection
          </h2>
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            <p>Connect from your phone:</p>
            <p className="mt-2" style={{ color: "var(--accent-gold)" }}>
              {typeof window !== "undefined" ? window.location.origin : "http://YOUR_PC_IP:3000"}
            </p>
            <p className="mt-2">
              Make sure your phone is on the same WiFi network as your PC.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
