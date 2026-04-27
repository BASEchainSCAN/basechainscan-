import {
  buildLowCapSpotlightFallback,
  buildLowCapSpotlightFallbackSlots,
  currentSlotDay,
  getSupabaseClient,
  isAfterSpotlightFallbackHour,
  loadSpotlightSeedData,
  mapSpotlightRow,
  normalizeAddress,
  normalizeTxHash,
  normalizeUrl,
  setCorsHeaders,
  slotDayToDate,
  verifySpotlightPayment,
} from './_spotlight.js';

function uniqueSlotsByDay(slots) {
  return slots.filter((slot, index, all) => slot && all.findIndex((candidate) => candidate.slot_day === slot.slot_day) === index);
}

function preserveSpotlightActionFields(slot) {
  if (!slot) return null;
  return {
    ...slot,
    primary_action_label: slot.primary_action_label || undefined,
    trade_url: slot.trade_url || undefined,
    trade_action_label: slot.trade_action_label || undefined,
    source: slot.source || undefined,
  };
}

function mergeSpotlightSlot(baseSlot, overlaySlot) {
  if (!baseSlot) return preserveSpotlightActionFields(overlaySlot);
  if (!overlaySlot) return preserveSpotlightActionFields(baseSlot);
  return preserveSpotlightActionFields({
    ...overlaySlot,
    ...baseSlot,
    project_logo_url: baseSlot.project_logo_url || overlaySlot.project_logo_url || undefined,
    project_url: baseSlot.project_url || overlaySlot.project_url || undefined,
    x_url: baseSlot.x_url || overlaySlot.x_url || undefined,
    video_url: baseSlot.video_url || overlaySlot.video_url || undefined,
    primary_action_label: baseSlot.primary_action_label || overlaySlot.primary_action_label || undefined,
    trade_url: baseSlot.trade_url || overlaySlot.trade_url || undefined,
    trade_action_label: baseSlot.trade_action_label || overlaySlot.trade_action_label || undefined,
    source: baseSlot.source || overlaySlot.source || undefined,
  });
}

function buildSpotlightPayload({
  seedData,
  todayRow = null,
  slotRows = [],
  takenRows = [],
  now = new Date(),
  fromDay = 0,
  toDay = 0,
}) {
  const todayDay = currentSlotDay(now);
  const rangeStart = fromDay || todayDay;
  const rangeEnd = toDay || todayDay + 30;

  const rawSeedSlots = Array.isArray(seedData?.slots) && seedData.slots.length
    ? seedData.slots
    : [seedData?.today, ...(seedData?.upcoming || [])];
  const seedSlots = uniqueSlotsByDay(rawSeedSlots
    .filter(Boolean)
    .map(preserveSpotlightActionFields)
    .filter((slot) => slot.slot_day >= rangeStart && slot.slot_day <= rangeEnd)
    .sort((left, right) => left.slot_day - right.slot_day));
  const seedSlotByDay = new Map(seedSlots.map((slot) => [slot.slot_day, slot]));

  const scheduledSeedToday = seedSlots.find((slot) => slot.slot_day === todayDay) || null;
  const mappedToday = mergeSpotlightSlot(
    preserveSpotlightActionFields(mapSpotlightRow(todayRow)),
    scheduledSeedToday,
  );
  const autoFallbackSlots = buildLowCapSpotlightFallbackSlots({
    now,
    fromDay: rangeStart,
    toDay: rangeEnd,
    count: 4,
  }).map(preserveSpotlightActionFields);
  const autoFallbackByDay = new Map(autoFallbackSlots.map((slot) => [slot.slot_day, slot]));
  const fallbackToday = !mappedToday && !scheduledSeedToday
    ? preserveSpotlightActionFields(autoFallbackByDay.get(todayDay) || buildLowCapSpotlightFallback(now))
    : null;

  const actualSlots = uniqueSlotsByDay((slotRows || []).map(mapSpotlightRow).map(preserveSpotlightActionFields).filter(Boolean))
    .map((slot) => mergeSpotlightSlot(slot, seedSlotByDay.get(slot.slot_day) || null));
  const slots = uniqueSlotsByDay([
    ...actualSlots,
    ...seedSlots.filter((seedSlot) => !actualSlots.some((slot) => slot.slot_day === seedSlot.slot_day)),
    ...autoFallbackSlots.filter((autoSlot) => (
      !actualSlots.some((slot) => slot.slot_day === autoSlot.slot_day)
      && !seedSlots.some((slot) => slot.slot_day === autoSlot.slot_day)
    )),
  ]).sort((left, right) => left.slot_day - right.slot_day);

  const seedTakenDays = [...(seedData?.takenDays || []), ...seedSlots.map((slot) => slot.slot_day)]
    .filter((day) => Number.isInteger(day) && day > 0)
    .filter((day) => day >= rangeStart && day <= rangeEnd)
    .filter((day, index, all) => all.indexOf(day) === index)
    .sort((left, right) => left - right);
  const mappedTakenDays = (takenRows || []).length
    ? (takenRows || []).map((row) => row.slot_day).filter((day) => Number.isInteger(day) && day > 0)
    : seedTakenDays;

  return {
    today: preserveSpotlightActionFields(mappedToday || scheduledSeedToday || fallbackToday || null),
    upcoming: slots.filter((slot) => slot.slot_day >= todayDay).map(preserveSpotlightActionFields),
    takenDays: mappedTakenDays,
    slots: slots.map(preserveSpotlightActionFields),
  };
}

export default async function handler(req, res) {
  setCorsHeaders(res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (error) {
    if (req.method === 'POST') {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Supabase is not configured' });
    }
  }

  if (req.method === 'GET') {
    const seedData = loadSpotlightSeedData();
    const now = new Date();
    const todayDay = currentSlotDay(now);
    const fromDay = Number.parseInt(String(req.query.fromDay || '0'), 10) || todayDay;
    const toDay = Number.parseInt(String(req.query.toDay || '0'), 10) || todayDay + 30;

    if (!supabase) {
      return res.status(200).json(buildSpotlightPayload({ seedData, now, fromDay, toDay }));
    }

    try {
      const todayReq = supabase
        .from('spotlight_slots')
        .select('*')
        .eq('slot_day', todayDay)
        .eq('status', 'approved')
        .limit(1)
        .maybeSingle();

      const slotsReq = supabase
        .from('spotlight_slots')
        .select('*')
        .eq('status', 'approved')
        .gte('slot_day', fromDay)
        .lte('slot_day', toDay)
        .order('slot_day', { ascending: true })
        .limit(90);

      const takenReq = supabase
        .from('spotlight_slots')
        .select('slot_day')
        .gte('slot_day', todayDay)
        .lte('slot_day', todayDay + 30);

      const [{ data: today, error: todayError }, { data: slots, error: slotsError }, { data: taken, error: takenError }] =
        await Promise.all([todayReq, slotsReq, takenReq]);

      if (todayError) throw todayError;
      if (slotsError) throw slotsError;
      if (takenError) throw takenError;

      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
      return res.status(200).json(buildSpotlightPayload({
        seedData,
        todayRow: today,
        slotRows: slots || [],
        takenRows: taken || [],
        now,
        fromDay,
        toDay,
      }));
    } catch (error) {
      console.error('[spotlight GET]', error);
      if (seedData) {
        return res.status(200).json(buildSpotlightPayload({ seedData, now, fromDay, toDay }));
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
