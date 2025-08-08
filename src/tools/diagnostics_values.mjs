import { z } from 'zod';
import {
  globToRegex,
  canonicalDeviceTypeFromDiagnostics,
  deriveDeviceNameFromDiagnostics,
  makeDeviceId,
  signalIdFromDbusPath,
  coerceValueRecord,
} from '../lib/vrm-utils.mjs';
import { chunkJsonArrayEnvelope, stableStringBytes } from '../lib/chunking.mjs';

export const descriptor = {
  name: 'diagnostics_values',
  description: 'Current values for diagnostics signals (chunked). Filters: include, devices, types, sinceTs. Deterministic ordering; includes units and timestamps.',
  inputSchema: {
    type: 'object',
    properties: {
      include: { type: 'array', items: { type: 'string' } },
      devices: { type: 'array', items: { type: 'string' } },
      types: { type: 'array', items: { type: 'string' } },
      sinceTs: { type: 'number' },
      maxChunkBytes: { type: 'number' },
    },
    additionalProperties: false,
  },
};

const Args = z.object({
  include: z.array(z.string()).optional(),
  devices: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  sinceTs: z.number().int().nonnegative().optional(),
  maxChunkBytes: z.number().int().positive().optional(),
}).strict();

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler(argsRaw = {}) {
    const args = Args.parse(argsRaw ?? {});
    const maxChunkBytes = args.maxChunkBytes ?? 128_000;
    const includeGlobs = (args.include && args.include.length) ? args.include.map(globToRegex) : null;
    const deviceGlobs = (args.devices && args.devices.length) ? args.devices.map(globToRegex) : null;
    const typeSet = (args.types && args.types.length) ? new Set(args.types.map(s => s.toLowerCase())) : null;
    const sinceTs = args.sinceTs ?? 0;

    const diag = await httpGetJson(`/installations/${cfg.siteId}/diagnostics`);

    const attrs = [];
    (function scan(node) {
      if (!node) return;
      if (Array.isArray(node)) { for (const x of node) scan(x); return; }
      if (typeof node === 'object') {
        if ('dbusPath' in node && typeof node.dbusPath === 'string' && node.dbusPath.startsWith('/')) attrs.push(node);
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (v && typeof v === 'object') scan(v);
        }
      }
    })(diag);

    const deviceMap = new Map();
    let maxTs = 0;
    for (const a of attrs) {
      const type = canonicalDeviceTypeFromDiagnostics(a);
      if (typeSet && !typeSet.has(type)) continue;
      const instance = (a.instance ?? 0);
      const deviceId = makeDeviceId(type, instance);
      const sid = signalIdFromDbusPath(a.dbusPath);
      if (!sid) continue;
      if (includeGlobs && !includeGlobs.some(rx => rx.test(sid))) continue;
      const v = coerceValueRecord(a);
      const ts = v.payload.ts || 0;
      if (sinceTs && !(ts > sinceTs)) continue;
      if (!deviceMap.has(deviceId)) {
        let name = (typeof a.deviceName === 'string' && a.deviceName) || (typeof a.customName === 'string' && a.customName) || null;
        if (!name) name = deriveDeviceNameFromDiagnostics(diag, instance, type);
        deviceMap.set(deviceId, { deviceId, type, name, instance, values: [] });
      }
      const record = (v.kind === 'state') ? { signalId: sid, ...v.payload } : { signalId: sid, ...v.payload };
      deviceMap.get(deviceId).values.push(record);
      if (ts && ts > maxTs) maxTs = ts;
    }

    const devices = [];
    for (const dev of deviceMap.values()) {
      if (deviceGlobs && !deviceGlobs.some(rx => rx.test(dev.deviceId))) continue;
      devices.push(dev);
    }
    devices.sort((a, b) => {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      const ai = a.instance ?? 0, bi = b.instance ?? 0;
      if (ai !== bi) return ai - bi;
      const an = a.name || '', bn = b.name || '';
      return an.localeCompare(bn, 'en');
    });
    for (const d of devices) d.values.sort((x, y) => x.signalId.localeCompare(y.signalId, 'en'));

    const captureTs = maxTs || Math.floor(Date.now() / 1000);
    const siteIdNum = Number(cfg.siteId);
    const envelopes = chunkJsonArrayEnvelope(
      devices,
      (index, total) => ({
        ok: true,
        schemaVersion: '0.1',
        capture: { siteId: siteIdNum, ts: captureTs },
        chunk: { index, of: total, bytes: 0 },
      }),
      Math.max(8_192, maxChunkBytes)
    );

    if (envelopes.length === 0) {
      return [{
        ok: true,
        schemaVersion: '0.1',
        capture: { siteId: siteIdNum, ts: captureTs },
        chunk: { index: 0, of: 1, bytes: stableStringBytes('{"ok":true}') },
        devices: [],
      }];
    }
    return envelopes;
  };
}


