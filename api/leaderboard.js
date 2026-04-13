import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Cache 60 secunde
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  try {
    const { data, error } = await supabase
      .from('gm_leaderboard')
      .select('*')
      .limit(20);

    if (error) throw error;

    return res.status(200).json({ success: true, leaderboard: data || [] });

  } catch (err) {
    console.error('[Leaderboard Error]', err);
    return res.status(500).json({ error: 'Could not load leaderboard' });
  }
}
