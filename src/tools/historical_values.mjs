import { z } from 'zod';

export const descriptor = {
  name: 'historical_values',
  description: 'Time-series via VRM /stats type=custom. Accepts VRM codes (e.g., PVP, PVV) and dbus:/... signals (auto-mapped). Provide startTs, endTs, resolution (e.g., 15mins, hours, days).',
  inputSchema: {
    type: 'object',
    properties: {
      signals: { type: 'array', items: { type: 'string' } },
      device: { type: 'string' },
      startTs: { type: 'number' },
      endTs: { type: 'number' },
      resolution: { type: 'string' },
    },
    additionalProperties: false,
  },
};

const Args = z.object({
  signals: z.array(z.string()),
  device: z.string().optional(),
  startTs: z.number().int().nonnegative(),
  endTs: z.number().int().nonnegative(),
  resolution: z.string().optional(),
}).strict();

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler(argsRaw = {}) {
    const args = Args.parse(argsRaw ?? {});
    const { signals, startTs, endTs, resolution } = args;

    const attributeCodes = new Set();
    const dbusSignals = [];
    for (const s of signals) {
      if (typeof s === 'string' && s.startsWith('dbus:')) dbusSignals.push(s);
      else if (typeof s === 'string' && s.trim()) attributeCodes.add(s.trim());
    }

    if (dbusSignals.length > 0) {
      const diag = await httpGetJson(`/installations/${cfg.siteId}/diagnostics`);
      const wantedPaths = new Set(
        dbusSignals.map((sid) => sid.replace(/^dbus:/, '')).filter((p) => p.startsWith('/'))
      );
      (function scan(node) {
        if (!node) return;
        if (Array.isArray(node)) { for (const x of node) scan(x); return; }
        if (typeof node === 'object') {
          const dbusPath = node.dbusPath;
          const code = node.code || node.vrmCode;
          if (typeof dbusPath === 'string' && wantedPaths.has(dbusPath) && typeof code === 'string' && code) attributeCodes.add(code);
          for (const k of Object.keys(node)) {
            const v = node[k];
            if (v && typeof v === 'object') scan(v);
          }
        }
      })(diag);
    }

    if (attributeCodes.size === 0) {
      const err = new Error('historical_values: no attribute codes resolved from signals');
      err.__mcp = { code: -32002, data: { signals } };
      throw err;
    }

    const params = new URLSearchParams();
    params.set('type', 'custom');
    params.set('show_instance', 'true');
    params.set('start', String(startTs));
    params.set('end', String(endTs));
    if (resolution) params.set('interval', String(resolution));
    for (const code of attributeCodes) params.append('attributeCodes[]', code);

    const path = `/installations/${cfg.siteId}/stats?${params.toString()}`;
    const json = await httpGetJson(path);
    return json;
  };
}


