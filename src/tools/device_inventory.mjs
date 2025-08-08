import { z } from 'zod';
import {
  globToRegex,
  canonicalDeviceTypeFromDiagnostics,
  deriveDeviceNameFromDiagnostics,
  makeDeviceId,
} from '../lib/vrm-utils.mjs';

export const descriptor = {
  name: 'device_inventory',
  description: 'List devices discovered from diagnostics (type, instance, name). Optional filters: types, devices. Good for selector resolution.',
  inputSchema: {
    type: 'object',
    properties: {
      types: { type: 'array', items: { type: 'string' } },
      devices: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
};

const Args = z.object({
  types: z.array(z.string()).optional(),
  devices: z.array(z.string()).optional(),
}).strict();

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler(argsRaw = {}) {
    const args = Args.parse(argsRaw ?? {});
    const typeSet = (args.types && args.types.length) ? new Set(args.types.map(s => s.toLowerCase())) : null;
    const deviceGlobs = (args.devices && args.devices.length) ? args.devices.map(globToRegex) : null;

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

    const map = new Map();
    for (const a of attrs) {
      const type = canonicalDeviceTypeFromDiagnostics(a);
      if (typeSet && !typeSet.has(type)) continue;
      const instance = (a.instance ?? 0);
      const deviceId = makeDeviceId(type, instance);
      if (deviceGlobs && !deviceGlobs.some(rx => rx.test(deviceId))) continue;
      if (!map.has(deviceId)) {
        let name = (typeof a.deviceName === 'string' && a.deviceName) || (typeof a.customName === 'string' && a.customName) || null;
        if (!name) name = deriveDeviceNameFromDiagnostics(diag, instance, type);
        map.set(deviceId, { deviceId, type, instance, name });
      }
    }

    const devices = Array.from(map.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      const ai = a.instance ?? 0, bi = b.instance ?? 0;
      if (ai !== bi) return ai - bi;
      const an = a.name || '', bn = b.name || '';
      return an.localeCompare(bn, 'en');
    });

    const payload = {
      ok: true,
      schemaVersion: '0.1',
      capture: { siteId: Number(cfg.siteId), ts: Math.floor(Date.now() / 1000) },
      devices,
    };

    return payload;
  };
}


