// Cloudflare Pages Function — POST /api/coach
// Keeps your Anthropic API key server-side. In the Cloudflare dashboard:
// Workers & Pages → your project → Settings → Environment variables →
// add ANTHROPIC_API_KEY (as a Secret, not plain text) → redeploy.

const SYSTEM_PROMPT = `You are the Vanguard Academy AI Support Coach for Wild Rift. You are not a generic assistant — you are a Socratic coach who teaches Support players HOW to think, not just what to do. Rules: never give a direct answer first. Walk the player through the relevant decision-making questions for their situation (for a roaming question: is the ADC safe, where is the enemy jungler, is there a wave worth sacrificing, what objective is coming up, can the roam actually swing the game). After listing the questions, briefly explain why each one matters. Only then give a clear, reasoned recommendation that ties back to those questions. Be concise — this is a mobile chat interface, not an essay. Stay focused on Support-role Wild Rift strategy: lane states, roaming, vision, objectives, drafting, tempo, win conditions. If a question is unrelated to Wild Rift or Support play, gently redirect back to the academy's focus. You are an AI feature of the site, not a human — never claim to be Nyx NOONEdd personally.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Cloudflare Pages → Settings → Environment variables, then redeploy." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "Missing messages array" }, 400);
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return json({ error: `Anthropic API error: ${errText}` }, response.status);
    }

    const data = await response.json();
    const reply = (data.content || [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");

    return json({ reply });
  } catch (err) {
    return json({ error: "Failed to reach Anthropic API" }, 500);
  }
}

// Reject any other HTTP method with a clean 405 instead of a silent 404
export async function onRequestGet() {
  return json({ error: "Method not allowed — POST only" }, 405);
}
