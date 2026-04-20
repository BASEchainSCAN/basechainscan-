import fs from 'node:fs/promises';
import path from 'node:path';

function unauthorized(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Spotlight Admin", charset="UTF-8"');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(401).send('Authentication required');
}

function parseBasicAuth(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const [scheme, encoded] = headerValue.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return null;
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedPassword = String(process.env.SPOTLIGHT_ADMIN_TOKEN || '').trim();
  if (!expectedPassword) {
    return res.status(500).send('Spotlight admin is not configured');
  }

  const credentials = parseBasicAuth(req.headers.authorization);
  if (!credentials || credentials.password !== expectedPassword) {
    return unauthorized(res);
  }

  try {
    const htmlPath = path.join(process.cwd(), 'public', 'spotlight-admin.html');
    const html = await fs.readFile(htmlPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  } catch (error) {
    console.error('[spotlight admin page]', error);
    return res.status(500).send('Failed to load admin page');
  }
}
