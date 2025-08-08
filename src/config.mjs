import 'dotenv/config';

export const cfg = {
  token: process.env.VRM_API_TOKEN?.trim(),
  siteId: process.env.VRM_SITE_ID?.trim(),
  authHeader: (process.env.VRM_AUTH_HEADER || 'X-Authorization').trim(),
  baseUrl: 'https://vrmapi.victronenergy.com/v2',
  timeoutMs: 15_000,
  defaultMaxChunkBytes: 128_000,
};

const envErrors = [];
if (!cfg.token) envErrors.push('VRM_API_TOKEN is required.');
if (!cfg.siteId || !/^\d+$/.test(cfg.siteId)) envErrors.push('VRM_SITE_ID is required and must be numeric.');
if (!cfg.authHeader) envErrors.push('VRM_AUTH_HEADER resolved empty (should default to X-Authorization).');
if (envErrors.length) {
  console.error('[VRM MCP] Startup configuration error:\n- ' + envErrors.join('\n- '));
  process.exit(1);
}


