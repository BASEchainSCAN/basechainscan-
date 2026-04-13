
// api/config.js
// Vercel Serverless Function — safe proxy for future secrets
// Environment variables are set in: Vercel Dashboard → Project → Settings → Environment Variables
// They are NEVER exposed to the browser or GitHub

export default function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Example: return only what the frontend needs, never the raw key
  // const apiKey = process.env.MY_API_KEY; // set in Vercel dashboard
  // Use apiKey server-side here, never send it to client

  res.status(200).json({
    chainId: 8453,
    network: 'base',
    // walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID  // uncomment when needed
  });
}
