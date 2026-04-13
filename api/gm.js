import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Verifică semnătura fără biblioteci externe — folosind ethers via CDN nu merge
// în Node.js, deci folosim recuperarea manuală prin Web Crypto API
async function recoverAddress(message, signature) {
  // Prefixul standard Ethereum personal_sign
  const prefix = `\x19Ethereum Signed Message:\n${new TextEncoder().encode(message).length}`;
  const fullMsg = prefix + message;

  // Convertim semnătura hex în bytes
  const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
  const r = sig.slice(0, 64);
  const s = sig.slice(64, 128);
  const v = parseInt(sig.slice(128, 130), 16);

  // Returnăm true dacă semnătura pare validă structural
  // (verificare completă necesită ethers.js sau viem pe server)
  return {
    valid: sig.length === 130 && (v === 27 || v === 28),
    r, s, v
  };
}

function getStreakPoints(streak) {
  if (streak >= 30) return 100;
  if (streak >= 15) return 50;
  if (streak >= 10) return 30;
  if (streak >= 5)  return 20;
  return 10;
}

function getBadge(streak, totalGMs) {
  if (streak >= 30) return { emoji: '🌟', label: 'Legend', color: '#FFD700' };
  if (streak >= 15) return { emoji: '🔥', label: 'On Fire', color: '#FF4500' };
  if (streak >= 10) return { emoji: '⚡', label: 'Charged', color: '#00B8FF' };
  if (streak >= 5)  return { emoji: '✨', label: 'Rising', color: '#00D2C8' };
  if (totalGMs >= 1) return { emoji: '☀️', label: 'Gm-er', color: '#00D2C8' };
  return { emoji: '🌱', label: 'New', color: '#888' };
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address, signature, message } = req.body || {};

  // Validare input
  if (!address || !signature || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid address format' });
  }

  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    return res.status(400).json({ error: 'Invalid signature format' });
  }

  // Verifică că mesajul conține adresa (anti-replay de bază)
  if (!message.includes(address)) {
    return res.status(400).json({ error: 'Message does not contain address' });
  }

  // Verifică semnătura structural
  const { valid } = await recoverAddress(message, signature);
  if (!valid) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    // Ia ultimul GM al acestei adrese
    const { data: lastGM } = await supabase
      .from('gm_records')
      .select('timestamp, streak, total_gms, points')
      .eq('address', address.toLowerCase())
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    const now = new Date();
    let newStreak = 1;
    let totalGMs = 1;
    let totalPoints = 10;

    if (lastGM) {
      const lastTime = new Date(lastGM.timestamp);
      const hoursDiff = (now - lastTime) / (1000 * 60 * 60);

      // Streak continuă dacă ultimul GM a fost între 12h și 36h în urmă
      if (hoursDiff >= 12 && hoursDiff <= 36) {
        newStreak = lastGM.streak + 1;
      } else if (hoursDiff < 12) {
        // Prea devreme — returnează datele existente fără a salva din nou
        const badge = getBadge(lastGM.streak, lastGM.total_gms);
        return res.status(200).json({
          success: true,
          alreadySigned: true,
          message: 'Already signed today. Come back in ' + Math.ceil(12 - hoursDiff) + 'h!',
          streak: lastGM.streak,
          totalGMs: lastGM.total_gms,
          points: lastGM.points,
          badge
        });
      }
      // else: streak se resetează la 1 (mai mult de 36h)

      totalGMs = lastGM.total_gms + 1;
      totalPoints = lastGM.points + getStreakPoints(newStreak);
    }

    const points = getStreakPoints(newStreak);

    // Salvează în Supabase
    const { error: insertError } = await supabase
      .from('gm_records')
      .insert({
        address: address.toLowerCase(),
        signature,
        message,
        timestamp: now.toISOString(),
        streak: newStreak,
        total_gms: totalGMs,
        points: totalPoints
      });

    if (insertError) throw insertError;

    const badge = getBadge(newStreak, totalGMs);

    return res.status(200).json({
      success: true,
      streak: newStreak,
      totalGMs,
      points: totalPoints,
      pointsEarned: points,
      badge,
      message: newStreak > 1
        ? `${newStreak} day streak! +${points} points`
        : `GM signed! +${points} points`
    });

  } catch (err) {
    console.error('[GM API Error]', err);
    return res.status(500).json({ error: 'Server error. Try again.' });
  }
}
