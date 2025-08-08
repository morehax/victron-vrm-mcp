import { z } from 'zod';
import { canonicalDeviceTypeFromDiagnostics } from '../lib/vrm-utils.mjs';

export const descriptor = {
  name: 'gps',
  description: 'Last-known GPS (official VRM widget). Returns lat, lon, speed, course, altitude. Falls back to diagnostics GPS signals if widget unavailable. Optional: instance.',
  inputSchema: {
    type: 'object',
    properties: { instance: { type: 'number' } },
    additionalProperties: false,
  },
};

const Args = z.object({ instance: z.number().int().nonnegative().optional() }).strict();

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler(argsRaw = {}) {
    const args = Args.parse(argsRaw ?? {});
    const params = new URLSearchParams();
    if (typeof args.instance === 'number') params.set('instance', String(args.instance));
    try {
      const json = await httpGetJson(`/installations/${cfg.siteId}/widgets/GPS?${params.toString()}`);
      return { source: 'vrm', ...json };
    } catch (e) {
      // Fallback: scan diagnostics
      const diag = await httpGetJson(`/installations/${cfg.siteId}/diagnostics`);
      const out = { source: 'diagnostics', data: {} };
      let latestTs = 0;
      (function scan(node) {
        if (!node) return;
        if (Array.isArray(node)) { for (const x of node) scan(x); return; }
        if (typeof node === 'object') {
          const p = node.dbusPath;
          const ts = typeof node.timestamp === 'number' ? node.timestamp : null;
          const asNum = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && isFinite(Number(v)) ? Number(v) : null));
          const fv = node.formattedValue || node.textValue || null;
          const rv = node.rawValue ?? node.value ?? null;
          const num = asNum(rv);
          if (p === '/Position/Latitude' && num !== null) { out.data.lat = num; if (ts && ts > latestTs) latestTs = ts; }
          if (p === '/Position/Longitude' && num !== null) { out.data.lng = num; if (ts && ts > latestTs) latestTs = ts; }
          if (p === '/Position/Altitude' && (num !== null || fv)) { out.data.altitude = num ?? fv; if (ts && ts > latestTs) latestTs = ts; }
          if (p === '/Speed' && num !== null) { out.data.speed = num; if (ts && ts > latestTs) latestTs = ts; }
          if (p === '/Course' && (num !== null || fv)) { out.data.course = num ?? fv; if (ts && ts > latestTs) latestTs = ts; }
          for (const k of Object.keys(node)) {
            const v = node[k];
            if (v && typeof v === 'object') scan(v);
          }
        }
      })(diag);
      if (latestTs) out.ts = latestTs;
      return out;
    }
  };
}


