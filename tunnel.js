/**
 * AIZEN PRO - Resilient Persistent Tunnel
 * Keeps the public tunnel online 24/7 with automatic reconnection
 */

const localtunnel = require('localtunnel');

const PORT = 3000;
const SUBDOMAIN = 'aizen-line-bot';

async function connectTunnel() {
  console.log(`[Tunnel] Connecting to port ${PORT} with subdomain '${SUBDOMAIN}'...`);

  try {
    const tunnel = await localtunnel({ port: PORT, subdomain: SUBDOMAIN });

    console.log(`====================================================`);
    console.log(`🚀 Public Tunnel Active: ${tunnel.url}`);
    console.log(`⚡ LINE Webhook URL: ${tunnel.url}/api/webhook/line`);
    console.log(`====================================================`);

    tunnel.on('close', () => {
      console.warn('[Tunnel] Connection closed. Reconnecting in 3s...');
      setTimeout(connectTunnel, 3000);
    });

    tunnel.on('error', (err) => {
      console.error('[Tunnel Error]', err.message);
      tunnel.close();
    });
  } catch (err) {
    console.error('[Tunnel Init Failed]', err.message, 'Retrying in 4s...');
    setTimeout(connectTunnel, 4000);
  }
}

connectTunnel();
