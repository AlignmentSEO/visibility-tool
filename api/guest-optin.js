// Vercel serverless function: POST /api/guest-optin
// ---------------------------------------------------------------------------
// Receives a guest opt-in from the post-visit landing page.
// Upserts into public.guests (one row per email per client_slug).
// On repeat visits: increments reservation_count, updates last_visit_date only.
//
// ZERO DEPENDENCIES: plain fetch + Supabase PostgREST, matching lead.js style.
//
// REQUIRED Vercel env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// REQUEST BODY (JSON):
//   email        string  required
//   client_slug  string  required  e.g. "bohemia"
//   consent      boolean required  must be true to store
//   visit_date   string  optional  ISO date e.g. "2026-06-15"
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body || '{}'); } catch (_) { body = null; }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ stored: false, error: 'Invalid JSON body' });
  }

  const { email, client_slug, consent, visit_date } = body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ stored: false, error: 'Valid email required' });
  }
  if (!client_slug || typeof client_slug !== 'string') {
    return res.status(400).json({ stored: false, error: 'client_slug required' });
  }
  if (consent !== true) {
    return res.status(400).json({ stored: false, error: 'Consent required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[GUEST_OPTIN] Supabase not configured');
    return res.status(200).json({ stored: false, reason: 'Supabase not configured' });
  }

  const base = SUPABASE_URL.replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY
  };

  const today = visit_date || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const cleanEmail = email.toLowerCase().trim();
  const cleanSlug = client_slug.toLowerCase().trim();

  try {
    // Step 1: Try to INSERT a new guest row.
    const insertResp = await fetch(base + '/rest/v1/guests', {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        email: cleanEmail,
        client_slug: cleanSlug,
        first_visit_date: today,
        last_visit_date: today,
        reservation_count: 1,
        consent: true,
        consent_at: now
      })
    });

    // New guest — success.
    if (insertResp.ok) {
      const rows = await insertResp.json().catch(() => null);
      const id = rows && rows[0] && rows[0].id || null;
      return res.status(200).json({ stored: true, id, returning: false });
    }

    // 409 = unique constraint violation = returning guest. Fall through to update.
    if (insertResp.status !== 409) {
      const detail = await insertResp.text().catch(() => '');
      console.error('[GUEST_OPTIN] Insert failed:', insertResp.status, detail.slice(0, 300));
      return res.status(502).json({ stored: false, error: 'Database insert failed' });
    }

    // Step 2: Returning guest — fetch their current row to get the id.
    const fetchResp = await fetch(
      base + '/rest/v1/guests?email=eq.' + encodeURIComponent(cleanEmail) +
      '&client_slug=eq.' + encodeURIComponent(cleanSlug) +
      '&select=id,reservation_count',
      { headers }
    );

    if (!fetchResp.ok) {
      console.error('[GUEST_OPTIN] Fetch existing row failed:', fetchResp.status);
      return res.status(502).json({ stored: false, error: 'Could not retrieve existing guest' });
    }

    const existing = await fetchResp.json().catch(() => null);
    const row = existing && existing[0];
    if (!row) {
      return res.status(502).json({ stored: false, error: 'Existing guest row not found' });
    }

    // Step 3: PATCH — increment count, update last visit only (preserve first_visit_date).
    const patchResp = await fetch(
      base + '/rest/v1/guests?id=eq.' + row.id,
      {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          last_visit_date: today,
          reservation_count: (row.reservation_count || 1) + 1
        })
      }
    );

    if (!patchResp.ok) {
      const detail = await patchResp.text().catch(() => '');
      console.error('[GUEST_OPTIN] Patch failed:', patchResp.status, detail.slice(0, 200));
      return res.status(502).json({ stored: false, error: 'Update failed' });
    }

    return res.status(200).json({ stored: true, id: row.id, returning: true });

  } catch (err) {
    console.error('[GUEST_OPTIN] Exception:', err && err.message);
    return res.status(500).json({ stored: false, error: 'Request failed' });
  }
}
