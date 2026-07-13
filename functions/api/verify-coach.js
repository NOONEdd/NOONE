// Cloudflare Pages Function — POST /api/verify-coach
// Called by the Coach Mode password prompt (src/components/Layout.jsx)
// before revealing any edit controls. This is a convenience/UX check --
// the real security boundary is the same COACH_PASSWORD check repeated
// server-side in functions/api/coach-overrides.js, so a write still can't
// succeed even if this endpoint were somehow skipped entirely.
//
// Uses the same COACH_PASSWORD environment variable set up for
// coach-overrides.js -- see the setup comment there.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function onRequestPost(context) {
  const correctPassword = context.env.COACH_PASSWORD;
  if (!correctPassword) {
    return json({ ok: false, error: "COACH_PASSWORD not set yet — add it in the Cloudflare dashboard (Settings → Environment variables) as a Secret, then redeploy." }, 500);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { password } = body || {};
  if (password === correctPassword) {
    return json({ ok: true });
  }
  return json({ ok: false, error: "Incorrect password" }, 401);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
