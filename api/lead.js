// Vercel serverless function: POST /api/lead
// ---------------------------------------------------------------------------
// Minimal lead-persistence layer for the Visibility Tool.
// Stores each Visibility Scan / Chat submission in Supabase (table: public.leads).
//
// ZERO DEPENDENCIES: uses the Supabase REST (PostgREST) endpoint via global fetch,
// matching the dependency-free style of api/scan.js (no package.json / build step).
//
// REQUIRED Vercel environment variables (server-side only — never exposed to client):
//   SUPABASE_URL                e.g. https://abcdefgh.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   the service_role key (bypasses RLS for server inserts)
//
// DESIGN NOTES:
// - Additive: this does NOT replace the Zapier path. Both run independently.
// - Fail-soft: if env vars are missing, returns 200 {stored:false} so the caller
//   (and the user-facing UI) is never broken by a misconfiguration.
// - CORS-enabled so the Squarespace embed + Vercel frontends can call it directly.
// - Robust extraction: handles BOTH payload shapes — chat v6.3 (nested
//   business{}/contact{}) and Oarfish scan (flat business/email/phone).
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Parse body (Vercel may deliver an object or a raw string)
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body || '{}'); } catch (_) { body = null; }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ stored: false, error: 'Invalid or empty JSON body' });
  }

  // Size guard (defensive)
  const raw = JSON.stringify(body);
  if (raw.length > 100000) {
    return res.status(413).json({ stored: false, error: 'Payload too large' });
  }

  // Extract the flat columns from either payload shape
  const business_name =
    (body.business && body.business.name) || body.business || body.bizName || null;
  const email   = (body.contact && body.contact.email) || body.email || null;
  const phone   = (body.contact && body.contact.phone) || body.phone || null;
  const scoreRaw = (body.score != null) ? body.score
                 : (body.report && body.report.total != null) ? body.report.total
                 : null;
  const scoreNum = (scoreRaw == null) ? null : Number(scoreRaw);
  const score = (scoreNum == null || isNaN(scoreNum)) ? null : scoreNum;

  // ---------------------------------------------------------------------------
  // Last-resort capture: whenever the lead is NOT durably stored in Supabase
  // (not configured, insert rejected, or exception), emit the full lead as a
  // single structured log line. Vercel's log drain retains this, so a lead is
  // recoverable instead of silently lost during the unconfigured/transient
  // window. Only fires on the not-stored paths — on success the lead already
  // lives in the DB and is not re-logged (avoids needless PII in logs).
  // ---------------------------------------------------------------------------
  function captureFallback(stage, detail) {
    try {
      console.error('[LEAD_CAPTURE_FALLBACK] ' + JSON.stringify({
        stage: stage,
        ts: new Date().toISOString(),
        business_name: business_name,
        email: email,
        phone: phone,
        score: score,
        detail: detail || null,
        payload: body
      }));
    } catch (_) { /* logging must never throw */ }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Fail soft if persistence is not yet configured — never break the caller,
  // but capture the lead to the log drain so it is not lost.
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    captureFallback('supabase_not_configured');
    return res.status(200).json({
      stored: false,
      reason: 'Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).'
    });
  }

  try {
    const resp = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        business_name: business_name,
        email: email,
        phone: phone,
        score: score,
        payload: body
      })
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(function () { return ''; });
      captureFallback('supabase_insert_failed', 'HTTP ' + resp.status + ' ' + String(detail).slice(0, 300));
      return res.status(502).json({
        stored: false,
        error: 'Supabase insert failed',
        status: resp.status,
        detail: String(detail).slice(0, 300)
      });
    }

    const rows = await resp.json().catch(function () { return null; });
    const id = (rows && rows[0] && rows[0].id) || null;
    return res.status(200).json({ stored: true, id: id });
  } catch (error) {
    captureFallback('insert_request_threw', (error && error.message) ? error.message : 'unknown error');
    return res.status(500).json({
      stored: false,
      error: 'Insert request failed',
      message: (error && error.message) ? error.message : 'unknown error'
    });
  }
}
