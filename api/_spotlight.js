import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

export const SPOTLIGHT_RECEIVER_ADDRESS = (
  process.env.SPOTLIGHT_RECEIVER_ADDRESS ||
  '0xaf0a6355d2698976d31d9fbdba53124746af6e9e'
).toLowerCase();

export const SPOTLIGHT_PRICE_ETH = process.env.SPOTLIGHT_PRICE_ETH || '0.01';
export const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const SPOTLIGHT_SEED_PATH = new URL('../public/data/spotlight-seed.json', import.meta.url);
const TOP4_FEED_PATH = new URL('../public/data/top4.json', import.meta.url);
const HEATMAP_FEED_PATH = new URL('../public/data/heatmap.json', import.meta.url);
const fallbackHour = Number.parseInt(process.env.SPOTLIGHT_FALLBACK_HOUR_UTC || '5', 10);
export const SPOTLIGHT_FALLBACK_HOUR_UTC = Number.isFinite(fallbackHour)
  ? Math.min(Math.max(fallbackHour, 0), 23)
  : 5;

function parseEthToWei(value) {
  const raw = String(value || '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error('Invalid SPOTLIGHT_PRICE_ETH value');
  }
  const [whole, fraction = ''] = raw.split('.');
  const paddedFraction = (fraction + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(paddedFraction);
}

export const SPOTLIGHT_PRICE_WEI = parseEthToWei(SPOTLIGHT_PRICE_ETH);

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
}

export function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || '';
  const key = getSupabaseKey();
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(url, key);
}

export function setCorsHeaders(res, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function currentSlotDay(now = new Date()) {
  return Math.floor(now.getTime() / 86_400_000);
}

export function slotDayToDate(slotDay) {
  return new Date(slotDay * 86_400_000).toISOString().slice(0, 10);
}

export function normalizeUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeAddress(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function normalizeTxHash(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function mapSpotlightRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    slot_day: row.slot_day,
    slot_date: row.slot_date,
    project_name: row.project_name,
    project_description: row.project_description,
    project_logo_url: row.project_logo_url,
    project_url: row.project_url,
    x_url: row.x_url || undefined,
    video_url: row.video_url || undefined,
    token_address: row.token_address || undefined,
    submitter_address: row.submitter_address || undefined,
    submitter_fid: row.submitter_fid || undefined,
    primary_action_label: row.primary_action_label || undefined,
    trade_url: row.trade_url || undefined,
    trade_action_label: row.trade_action_label || undefined,
    source: row.source || undefined,
    status: row.status,
    nft_token_id: row.nft_token_id || undefined,
    tx_hash: row.tx_hash || undefined,
    approved_at: row.approved_at || undefined,
    created_at: row.created_at,
  };
}

export function loadSpotlightSeedData() {
  try {
    const raw = fs.readFileSync(SPOTLIGHT_SEED_PATH, 'utf-8');
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return null;
    const explicitSlots = Array.isArray(payload.slots) ? payload.slots.map(mapSpotlightRow).filter(Boolean) : [];
    const today = payload.today ? mapSpotlightRow(payload.today) : null;
    const upcoming = Array.isArray(payload.upcoming) ? payload.upcoming.map(mapSpotlightRow).filter(Boolean) : [];
    const slots = [...explicitSlots, ...[today, ...upcoming].filter(Boolean)]
      .filter((slot, index, all) => all.findIndex((candidate) => candidate.slot_day === slot.slot_day) === index)
      .sort((left, right) => left.slot_day - right.slot_day);
    const takenDays = Array.isArray(payload.takenDays)
      ? payload.takenDays.map((value) => Number.parseInt(String(value || '0'), 10)).filter((value) => value > 0)
      : [];
    return { today, upcoming, slots, takenDays };
  } catch {
    return null;
  }
}

export function loadTop4Feed() {
  try {
    const raw = fs.readFileSync(TOP4_FEED_PATH, 'utf-8');
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return null;
    return {
      generated_at: typeof payload.generated_at === 'string' ? payload.generated_at : null,
      tokens: Array.isArray(payload.tokens) ? payload.tokens : [],
    };
  } catch {
    return null;
  }
}

export function loadHeatmapFeed() {
  try {
    const raw = fs.readFileSync(HEATMAP_FEED_PATH, 'utf-8');
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return null;
    return {
      generated_at: typeof payload.generated_at === 'string' ? payload.generated_at : null,
      tokens: Array.isArray(payload.tokens) ? payload.tokens : [],
    };
  } catch {
    return null;
  }
}

export function isAfterSpotlightFallbackHour(now = new Date()) {
  return now.getUTCHours() >= SPOTLIGHT_FALLBACK_HOUR_UTC;
}

function formatCompactUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const digits = value >= 1_000_000 ? 1 : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSignedPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function lowCapSpotlightCandidates() {
  const top4Feed = loadTop4Feed();
  const heatmapFeed = loadHeatmapFeed();
  const seen = new Set();
  const out = [];
  for (const token of [...(top4Feed?.tokens || []), ...(heatmapFeed?.tokens || [])]) {
    const symbol = String(token?.symbol || '').trim();
    const address = String(token?.token_address || '').trim().toLowerCase();
    const key = address || symbol.toUpperCase();
    if (!symbol || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...token,
      generated_at: token.generated_at || top4Feed?.generated_at || heatmapFeed?.generated_at || null,
    });
  }
  return out;
}

function buildLowCapSpotlightSlotFromToken(token, slotDay, now = new Date()) {
  if (!token) return null;

  const tradeUrl = token.o1_url || token.dexscreener_url || token.okx_url;
  const projectUrl = token.x_url || token.dexscreener_url || token.okx_url || tradeUrl;
  const marketCap = formatCompactUsd(token.mcap_usd);
  const liquidity = formatCompactUsd(token.lp_total_usd);
  const move24h = formatSignedPercent(token.price_change_24h);
  const metrics = [marketCap ? `Mcap ${marketCap}` : null, liquidity ? `liquidity ${liquidity}` : null, move24h ? `${move24h} in 24h` : null]
    .filter(Boolean)
    .join(', ');
  const metricLine = metrics ? ` ${metrics}.` : '';
  const venue = token.o1_url ? 'O1 Exchange' : token.dexscreener_url ? 'DEXScreener' : 'the live pair';

  return {
    id: `auto-lowcap-${slotDay}`,
    slot_day: slotDay,
    slot_date: slotDayToDate(slotDay),
    project_name: token.symbol,
    project_description: `Today's auto Spotlight from Low Caps Emerging: ${token.symbol}.${metricLine} Watch the live Base setup on ${venue}.`,
    project_logo_url: null,
    project_url: projectUrl,
    x_url: token.x_url || undefined,
    video_url: undefined,
    token_address: normalizeAddress(token.token_address) || undefined,
    submitter_address: undefined,
    submitter_fid: undefined,
    primary_action_label: token.x_url ? 'Open on X ->' : projectUrl === token.dexscreener_url ? 'Open on DEX ->' : 'Open setup ->',
    trade_url: tradeUrl || undefined,
    trade_action_label: token.o1_url ? 'Trade on O1 ->' : token.dexscreener_url ? 'Open on DEX ->' : token.okx_url ? 'Trade on OKX ->' : undefined,
    source: 'lowcaps_auto',
    status: 'auto_fallback',
    nft_token_id: undefined,
    tx_hash: undefined,
    approved_at: now.toISOString(),
    created_at: token.generated_at || now.toISOString(),
  };
}

export function buildLowCapSpotlightFallback(now = new Date()) {
  return buildLowCapSpotlightSlotFromToken(lowCapSpotlightCandidates()[0], currentSlotDay(now), now);
}

export function buildLowCapSpotlightFallbackSlots({
  now = new Date(),
  fromDay = 0,
  toDay = 0,
  count = 4,
} = {}) {
  const todayDay = currentSlotDay(now);
  const rangeStart = fromDay || todayDay - 3;
  const rangeEnd = toDay || todayDay;
  const candidates = lowCapSpotlightCandidates().slice(0, Math.max(1, count));
  return candidates
    .map((token, index) => buildLowCapSpotlightSlotFromToken(token, todayDay - index, now))
    .filter(Boolean)
    .filter((slot) => slot.slot_day >= rangeStart && slot.slot_day <= rangeEnd)
    .sort((left, right) => left.slot_day - right.slot_day);
}

export async function jsonRpc(method, params = []) {
  const response = await fetch(BASE_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Base RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || 'Base RPC error');
  }

  return payload.result;
}

function parseRpcHexToBigInt(value) {
  if (!value || typeof value !== 'string') return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export async function verifySpotlightPayment({ txHash, submitterAddress }) {
  const normalizedHash = normalizeTxHash(txHash);
  const normalizedSubmitter = normalizeAddress(submitterAddress);

  if (!normalizedHash) {
    return { ok: false, code: 'invalid_tx_hash', reason: 'Transaction hash is invalid.' };
  }

  const tx = await jsonRpc('eth_getTransactionByHash', [normalizedHash]);
  if (!tx) {
    return { ok: false, code: 'tx_not_found', reason: 'Transaction could not be found on Base.' };
  }

  const toAddress = (tx.to || '').toLowerCase();
  const fromAddress = (tx.from || '').toLowerCase();
  const valueWei = parseRpcHexToBigInt(tx.value);

  if (toAddress !== SPOTLIGHT_RECEIVER_ADDRESS) {
    return {
      ok: false,
      code: 'wrong_recipient',
      reason: 'Transaction was not sent to the configured Spotlight receiver.',
      toAddress,
      fromAddress,
      valueWei: valueWei.toString(),
    };
  }

  if (normalizedSubmitter && fromAddress !== normalizedSubmitter) {
    return {
      ok: false,
      code: 'wrong_sender',
      reason: 'Transaction sender does not match the submitted wallet address.',
      toAddress,
      fromAddress,
      valueWei: valueWei.toString(),
    };
  }

  if (valueWei < SPOTLIGHT_PRICE_WEI) {
    return {
      ok: false,
      code: 'value_too_low',
      reason: `Transaction value is below the required ${SPOTLIGHT_PRICE_ETH} ETH.`,
      toAddress,
      fromAddress,
      valueWei: valueWei.toString(),
    };
  }

  let confirmationState = 'pending_confirmation';
  const receipt = await jsonRpc('eth_getTransactionReceipt', [normalizedHash]).catch(() => null);
  if (receipt) {
    if (receipt.status === '0x1') {
      confirmationState = 'confirmed';
    } else if (receipt.status === '0x0') {
      return {
        ok: false,
        code: 'tx_failed',
        reason: 'Transaction was found but it failed on-chain.',
        toAddress,
        fromAddress,
        valueWei: valueWei.toString(),
        receiptStatus: receipt.status,
      };
    }
  }

  return {
    ok: true,
    code: confirmationState,
    reason: confirmationState === 'confirmed'
      ? 'Payment verified on Base.'
      : 'Transaction found on Base and is awaiting final confirmation.',
    toAddress,
    fromAddress,
    valueWei: valueWei.toString(),
  };
}

