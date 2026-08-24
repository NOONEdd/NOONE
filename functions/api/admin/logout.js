// Cloudflare Pages Function — POST /api/admin/logout
// Clears the admin session cookie. No password check needed to log
// out -- there's nothing sensitive about ending your own session, and
// requiring auth here would make it impossible to clear a broken/stale
// cookie without first successfully logging in.

import { buildLogoutCookie } from "../../_lib/adminAuth.js";

export async function onRequestPost(context) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": buildLogoutCookie(context.request),
    },
  });
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
