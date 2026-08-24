// Cloudflare Pages Function — GET /api/admin/session
//
// The browser can't read an HttpOnly cookie directly, so this is how
// src/hooks/useCoachOverrides.js finds out on page load whether the
// visitor already has a valid admin session (e.g. they logged in
// earlier today and are just browsing the public site) versus needs to
// go log in at #/admin. Read-only, no side effects, safe to call from
// any page.

import { requireAdminSession } from "../../_lib/adminAuth.js";

export async function onRequestGet(context) {
  const authenticated = await requireAdminSession(context);
  return new Response(JSON.stringify({ authenticated }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
