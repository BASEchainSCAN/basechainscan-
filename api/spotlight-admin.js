import {
  getSupabaseClient,
  isAuthorizedAdminRequest,
  mapSpotlightRow,
  normalizeAddress,
  normalizeUrl,
  normalizeTxHash,
  setCorsHeaders,
  verifySpotlightPayment,
} from './_spotlight.js';

export default async function handler(req, res) {
  setCorsHeaders(res, 'GET, PATCH, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = isAuthorizedAdminRequest(req);
  if (!auth.authorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Supabase is not configured' });
  }

  if (req.method === 'GET') {
    try {
      const withVerification = String(req.query.withVerification || '') === '1';
      const { data, error } = await supabase
        .from('spotlight_slots')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data || []).map(mapSpotlightRow);
      const slots = withVerification
        ? await Promise.all(rows.map(async (slot) => {
            if (!slot?.tx_hash) {
              return { ...slot, verification: null };
            }
            try {
              const verification = await verifySpotlightPayment({
                txHash: slot.tx_hash,
                submitterAddress: slot.submitter_address,
              });
              return { ...slot, verification };
            } catch (verifyError) {
              return {
                ...slot,
                verification: {
                  ok: false,
                  code: 'verify_failed',
                  reason: verifyError instanceof Error ? verifyError.message : 'Verification failed',
                },
              };
            }
          }))
        : rows;

      return res.status(200).json({
        slots,
        auth_mode: auth.mode,
      });
    } catch (error) {
      console.error('[spotlight admin GET]', error);
      return res.status(500).json({ error: 'Failed to load spotlight submissions' });
    }
  }

  try {
    const body = req.body || {};
    const id = typeof body.id === 'string' ? body.id : '';
    const action = typeof body.action === 'string' ? body.action : '';

    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    if (action === 'update') {
      const patch = {};

      if (body.projectName !== undefined) patch.project_name = String(body.projectName || '').trim();
      if (body.projectDescription !== undefined) patch.project_description = String(body.projectDescription || '').trim();
      if (body.projectLogoUrl !== undefined) patch.project_logo_url = normalizeUrl(body.projectLogoUrl);
      if (body.projectUrl !== undefined) patch.project_url = normalizeUrl(body.projectUrl);
      if (body.xUrl !== undefined) patch.x_url = normalizeUrl(body.xUrl);
      if (body.videoUrl !== undefined) patch.video_url = normalizeUrl(body.videoUrl);
      if (body.tokenAddress !== undefined) patch.token_address = normalizeAddress(body.tokenAddress);
      if (body.txHash !== undefined) patch.tx_hash = normalizeTxHash(body.txHash);

      const { data, error } = await supabase
        .from('spotlight_slots')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;

      return res.status(200).json({ slot: mapSpotlightRow(data) });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (action === 'approve') {
      const { data: existing, error: existingError } = await supabase
        .from('spotlight_slots')
        .select('*')
        .eq('id', id)
        .single();

      if (existingError) throw existingError;

      const slot = mapSpotlightRow(existing);
      if (slot?.tx_hash) {
        const verification = await verifySpotlightPayment({
          txHash: slot.tx_hash,
          submitterAddress: slot.submitter_address,
        });
        if (!verification.ok) {
          return res.status(400).json({
            error: 'Spotlight payment could not be re-verified on Base',
            verification,
          });
        }
      }
    }

    const updatePayload = action === 'approve'
      ? { status: 'approved', approved_at: new Date().toISOString() }
      : { status: 'rejected' };

    const { data, error } = await supabase
      .from('spotlight_slots')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(200).json({ slot: mapSpotlightRow(data) });
  } catch (error) {
    console.error('[spotlight admin PATCH]', error);
    return res.status(500).json({ error: 'Failed to update spotlight submission' });
  }
}
