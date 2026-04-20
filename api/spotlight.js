import {
  currentSlotDay,
  getSupabaseClient,
  loadSpotlightSeedData,
  mapSpotlightRow,
  normalizeAddress,
  normalizeTxHash,
  normalizeUrl,
  setCorsHeaders,
  slotDayToDate,
  verifySpotlightPayment,
} from './_spotlight.js';

export default async function handler(req, res) {
  setCorsHeaders(res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Supabase is not configured' });
  }

  if (req.method === 'GET') {
    const seedData = loadSpotlightSeedData();
    try {
      const fromDay = Number.parseInt(String(req.query.fromDay || '0'), 10) || 0;
      const toDay = Number.parseInt(String(req.query.toDay || '0'), 10) || 0;
      const todayDay = currentSlotDay();

      const todayReq = supabase
        .from('spotlight_slots')
        .select('*')
        .eq('slot_day', todayDay)
        .eq('status', 'approved')
        .limit(1)
        .maybeSingle();

      const upcomingReq = supabase
        .from('spotlight_slots')
        .select('*')
        .gte('slot_day', todayDay)
        .order('slot_day', { ascending: true })
        .limit(60);

      const takenReq = fromDay && toDay
        ? supabase
            .from('spotlight_slots')
            .select('slot_day')
            .gte('slot_day', fromDay)
            .lte('slot_day', toDay)
        : Promise.resolve({ data: [], error: null });

      const [{ data: today, error: todayError }, { data: upcoming, error: upcomingError }, { data: taken, error: takenError }] =
        await Promise.all([todayReq, upcomingReq, takenReq]);

      if (todayError) throw todayError;
      if (upcomingError) throw upcomingError;
      if (takenError) throw takenError;

      const mappedToday = mapSpotlightRow(today) || seedData?.today || null;
      const mappedUpcoming = (upcoming || []).length
        ? (upcoming || []).map(mapSpotlightRow)
        : (seedData?.upcoming || []);
      const mappedTakenDays = (taken || []).length
        ? (taken || []).map((row) => row.slot_day)
        : (seedData?.takenDays || []);

      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
      return res.status(200).json({
        today: mappedToday,
        upcoming: mappedUpcoming,
        takenDays: mappedTakenDays,
      });
    } catch (error) {
      console.error('[spotlight GET]', error);
      if (seedData) {
        return res.status(200).json(seedData);
      }
      return res.status(500).json({ error: 'Failed to fetch spotlight data' });
    }
  }

  try {
    const body = req.body || {};
    const slotDay = Number.parseInt(String(body.slot_day || '0'), 10) || 0;
    const projectName = typeof body.project_name === 'string' ? body.project_name.trim() : '';
    const projectDescription =
      typeof body.project_description === 'string' ? body.project_description.trim() : '';
    const projectUrl = normalizeUrl(body.project_url);
    const projectLogoUrl = normalizeUrl(body.project_logo_url);
    const xUrl = normalizeUrl(body.x_url);
    const videoUrl = normalizeUrl(body.video_url);
    const tokenAddress = normalizeAddress(body.token_address);
    const submitterAddress = normalizeAddress(body.submitter_address);
    const submitterFid = Number.parseInt(String(body.submitter_fid || '0'), 10) || null;
    const txHash = normalizeTxHash(body.tx_hash);
    const nftTokenId = Number.parseInt(String(body.nft_token_id || '0'), 10) || null;
    const todayDay = currentSlotDay();
    const maxSlotDay = todayDay + 30;

    if (!slotDay || !projectName || !projectDescription || !projectUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (slotDay < todayDay || slotDay > maxSlotDay) {
      return res.status(400).json({ error: 'Spotlight day must be within the current 30-day booking window' });
    }

    if (!projectUrl) {
      return res.status(400).json({ error: 'Project URL must be a valid http(s) URL' });
    }

    if (body.project_logo_url && !projectLogoUrl) {
      return res.status(400).json({ error: 'Logo URL must be a valid http(s) URL' });
    }

    if (body.x_url && !xUrl) {
      return res.status(400).json({ error: 'X URL must be a valid http(s) URL' });
    }

    if (body.video_url && !videoUrl) {
      return res.status(400).json({ error: 'Video URL must be a valid http(s) URL' });
    }

    if (!txHash) {
      return res.status(400).json({ error: 'Transaction hash is required for Spotlight submissions' });
    }

    const slotDate = typeof body.slot_date === 'string' && body.slot_date.trim()
      ? body.slot_date.trim()
      : slotDayToDate(slotDay);

    const [{ data: existingDay, error: dayError }, { data: existingTx, error: txError }] = await Promise.all([
      supabase.from('spotlight_slots').select('id').eq('slot_day', slotDay).limit(1),
      supabase.from('spotlight_slots').select('id').eq('tx_hash', txHash).limit(1),
    ]);

    if (dayError) throw dayError;
    if (txError) throw txError;

    if ((existingDay || []).length > 0) {
      return res.status(409).json({ error: 'This day is already taken' });
    }

    if ((existingTx || []).length > 0) {
      return res.status(409).json({ error: 'This transaction hash has already been used' });
    }

    const paymentVerification = await verifySpotlightPayment({
      txHash,
      submitterAddress,
    });

    if (!paymentVerification.ok) {
      return res.status(400).json({
        error: paymentVerification.reason,
        verification: paymentVerification,
      });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('spotlight_slots')
      .insert({
        slot_day: slotDay,
        slot_date: slotDate,
        project_name: projectName,
        project_description: projectDescription,
        project_logo_url: projectLogoUrl,
        project_url: projectUrl,
        x_url: xUrl,
        video_url: videoUrl,
        token_address: tokenAddress,
        submitter_address: submitterAddress,
        submitter_fid: submitterFid,
        status: 'pending',
        nft_token_id: nftTokenId,
        tx_hash: txHash,
      })
      .select('*')
      .single();

    if (insertError) throw insertError;

    return res.status(201).json({
      slot: mapSpotlightRow(inserted),
      verification: paymentVerification,
    });
  } catch (error) {
    console.error('[spotlight POST]', error);
    return res.status(500).json({ error: 'Failed to create spotlight submission' });
  }
}
