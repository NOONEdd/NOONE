import { useState } from "react";
import { Pencil } from "lucide-react";

// IMPORTANT: this calls /api/coach (a Cloudflare Pages Function — see functions/api/coach.js)
// instead of api.anthropic.com directly. Never call the Anthropic API directly
// from browser code in a deployed app — that would require shipping your API
// key to every visitor's browser, where anyone could read and misuse it.
// The serverless function keeps the key server-side as an environment variable.

export default function AICoachPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        // Non-JSON response (e.g. a network/edge error page) -- data stays null,
        // handled by the fallback message below.
      }
      if (!response.ok) {
        // functions/api/coach.js always sends a short, specific, SAFE `error`
        // string for every failure case (rate limit, conversation too long,
        // provider down, not configured yet, etc.) -- show it instead of a
        // generic message so the person knows what actually happened. Only
        // fall back to a generic message if the response had no parseable
        // error body at all.
        throw new Error((data && data.error) || "Couldn't reach the coach. Try again.");
      }
      setMessages((prev) => [...prev, { role: "assistant", content: (data && data.reply) || "Didn't catch that — try asking again." }]);
    } catch (e) {
      setError(e.message || "Couldn't reach the coach. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 720 }}>
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />AI Support Coach</div>
          <h2>Ask The Coach</h2>
          <p>Don't expect a quick answer. Expect to be walked through how to think about it.</p>
        </div>

        <div className="coach-chat">
          {messages.length === 0 && (
            <div className="placeholder-box">
              <Pencil size={16} />
              <p>Try: "should I roam now?" or "when do I buy Locket instead of Redemption?" The coach walks through the decision instead of just handing you an answer.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={"coach-msg " + (m.role === "user" ? "coach-msg-user" : "coach-msg-coach")}>
              {m.content}
            </div>
          ))}
          {loading && <div className="coach-msg coach-msg-coach coach-msg-loading">Thinking it through...</div>}
        </div>

        {error && <p className="coach-error">{error}</p>}

        <div className="coach-input-row">
          <input
            type="text"
            value={input}
            placeholder="Ask a Support question..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
          />
          <button className="btn btn-primary btn-small" onClick={sendMessage} disabled={loading}>
            {loading ? "..." : "Ask"}
          </button>
        </div>
        <p className="coach-disclaimer">An AI feature of Nyx NOONEdd Academy — not a substitute for 1-on-1 coaching.</p>
        <p className="coach-disclaimer">Builds, tiers, and matchup notes reflect patch 7.2b.</p>
      </div>
    </section>
  );
}
