import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

export const SPOTLIGHT_RECEIVER_ADDRESS = (
  process.env.SPOTLIGHT_RECEIVER_ADDRESS ||
  '0xaf0a6355d2698976d31d9fbdba53124746af6e9e'
).toLowerCase();

export const SPOTLIGHT_PRICE_ETH = process.env.SPOTLIGHT_PRICE_ETH || '0.01';
export const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
export const OWNER_FID = Number.parseInt(process.env.NEXT_PUBLIC_USER_FID || '0', 10) || 0;
export const ALLOW_FID_ADMIN_FALLBACK = process.env.SPOTLIGHT_ALLOW_FID_FALLBACK === 'true';
const SPOTLIGHT_SEED_PATH = new URL('../public/data/spotlight-seed.json', import.meta.url);

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-fid');
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
    const today = payload.today ? mapSpotlightRow(payload.today) : null;
    const upcoming = Array.isArray(payload.upcoming) ? payload.upcoming.map(mapSpotlightRow).filter(Boolean) : [];
    const takenDays = Array.isArray(payload.takenDays)
      ? payload.takenDays.map((value) => Number.parseInt(String(value || '0'), 10)).filter((value) => value > 0)
      : [];
    return { today, upcoming, takenDays };
  } catch {
    return null;
  }
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

export function isAuthorizedAdminRequest(req) {
  const adminToken = req.headers['x-admin-token'];
  const expectedToken = process.env.SPOTLIGHT_ADMIN_TOKEN;

  if (expectedToken) {
    if (typeof adminToken === 'string' && adminToken === expectedToken) {
      return { authorized: true, mode: 'token' };
    }
    return { authorized: false, mode: 'token' };
  }

  if (!ALLOW_FID_ADMIN_FALLBACK) {
    return { authorized: false, mode: 'token_required' };
  }

  const fidHeader = req.headers['x-fid'];
  const rawFid = Array.isArray(fidHeader) ? fidHeader[0] : fidHeader;
  const parsedFid = Number.parseInt(rawFid || '0', 10) || 0;

  if (OWNER_FID && parsedFid === OWNER_FID) {
    return { authorized: true, mode: 'fid' };
  }

  return { authorized: false, mode: OWNER_FID ? 'fid' : 'none' };
}
