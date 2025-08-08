import { cfg } from './config.mjs';
import { Headers, fetch } from 'undici';

export async function httpGetJson(path) {
  const url = `${cfg.baseUrl}${path}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('Request timed out')), cfg.timeoutMs);
  const headers = new Headers({ Accept: 'application/json' });
  headers.set(cfg.authHeader, `Token ${cfg.token}`);
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    const snippet = text.slice(0, 400);
    const err = new Error(`VRM request failed: ${res.status} ${res.statusText}`);
    err.__mcp = { code: -32000, data: { endpoint: path, snippet } };
    throw err;
  }
  return typeof parsed === 'object' && parsed !== null ? parsed : { raw: text };
}

export async function httpPostJson(path, body) {
  const url = `${cfg.baseUrl}${path}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('Request timed out')), cfg.timeoutMs);
  const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
  headers.set(cfg.authHeader, `Token ${cfg.token}`);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body ?? {}), signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    const snippet = text.slice(0, 400);
    const err = new Error(`VRM request failed: ${res.status} ${res.statusText}`);
    err.__mcp = { code: -32000, data: { endpoint: path, snippet } };
    throw err;
  }
  return typeof parsed === 'object' && parsed !== null ? parsed : { raw: text };
}


