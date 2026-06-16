// Vercel serverless function: POST /api/guest-review
// ---------------------------------------------------------------------------
// Stores the review text a guest wrote on the post-visit page.
// Called after /api/guest-optin returns an id.
// The stored text is reused for: Google review pre-fill, testimonials,
// social posts, weekly highlights email.
//
// ZERO DEPENDENCIES: plain fetch + Supabase PostgREST.
//
// REQUIRED Vercel env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// REQUEST BODY (JSON):
//   guest_id     string  required  uuid returned by /api/guest-optin
//   review_text  string  required  what the guest wrote (max 2000 chars)
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
    return res.status(400).json({ saved: false, error: 'Invalid JSON body' });
  }

  const { guest_id, review_text } = body;

  if (!guest_id || typeof guest_id !== 'string') {
    return res.status(400).json({ saved: false, error: 'guest_id required' });
  }
  if (!review_text || typeof review_text !== 'string' || review_text.trim().length < 5) {
    return res.status(400).json({ saved: false, error: 'review_text too short' });
  }

  const text = review_text.trim().slice(0, 2000);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[GUEST_REVIEW] Supabase not configured');
    return res.status(200).json({ saved: false, reason: 'Supabase not configured' });
  }

  try {
    const resp = await fetch(
      SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/guests?id=eq.' + encodeURIComponent(guest_id),
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          review_text: text,
          review_text_at: new Date().toISOString(),
          review_submitted: true
        })
      }
    );

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('[GUEST_REVIEW] Patch failed:', resp.status, detail.slice(0, 300));
      return res.status(502).json({ saved: false, error: 'Database update failed' });
    }

    return res.status(200).json({ saved: true });

  } catch (err) {
    console.error('[GUEST_REVIEW] Exception:', err && err.message);
    return res.status(500).json({ saved: false, error: 'Request failed' });
  }
}
