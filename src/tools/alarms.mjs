import { z } from 'zod';
import { coerceValueRecord, canonicalDeviceTypeFromDiagnostics, makeDeviceId } from '../lib/vrm-utils.mjs';

export const descriptor = {
  name: 'alarms',
  description: 'Active alarms for the installation (official VRM). Falls back to scanning diagnostics /Alarms/* if unavailable. Optional: sinceTs.',
  inputSchema: {
    type: 'object',
    properties: { sinceTs: { type: 'number' } },
    additionalProperties: false,
  },
};

const Args = z.object({ sinceTs: z.number().int().nonnegative().optional() }).strict();

async function scanDiagnosticsForAlarms(httpGetJson, cfg) {
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

  const active = [];
  for (const a of attrs) {
    const path = a.dbusPath || '';
    if (!/\/Alarms\//i.test(path)) continue;
    const type = canonicalDeviceTypeFromDiagnostics(a);
    const instance = (a.instance ?? 0);
    const deviceId = makeDeviceId(type, instance);
    const v = coerceValueRecord(a);
    let isAlarm = false;
    let value = null;
    let text = null;
    if (v.kind === 'state') {
      value = v.payload.state?.value ?? null;
      text = v.payload.state?.text ?? null;
    } else {
      value = v.payload.value ?? null;
    }
    if (typeof value === 'number') isAlarm = value !== 0;
    else if (typeof value === 'string') { text = value; isAlarm = !/^\s*(ok|no alarm)\s*$/i.test(value); }
    else if (typeof text === 'string') isAlarm = !/^\s*(ok|no alarm)\s*$/i.test(text);
    if (!isAlarm) continue;
    active.push({ deviceId, type, instance, signalId: `dbus:${path}`, ...(
      v.kind === 'state' ? { state: v.payload.state, ts: v.payload.ts ?? null, source: v.payload.source } : { value: v.payload.value, unit: v.payload.unit ?? null, ts: v.payload.ts ?? null, source: v.payload.source }
    ) });
  }
  active.sort((a, b) => {
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    const ai = a.instance ?? 0, bi = b.instance ?? 0;
    if (ai !== bi) return ai - bi;
    return a.signalId.localeCompare(b.signalId, 'en');
  });
  return { ok: true, schemaVersion: '0.1', capture: { siteId: Number(cfg.siteId), ts: Math.floor(Date.now() / 1000) }, count: active.length, alarms: active, source: 'diagnostics' };
}

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler(argsRaw = {}) {
    const args = Args.parse(argsRaw ?? {});
    const params = new URLSearchParams();
    if (typeof args.sinceTs === 'number') params.set('since', String(args.sinceTs));
    try {
      const json = await httpGetJson(`/installations/${cfg.siteId}/alarms?${params.toString()}`);
      return { source: 'vrm', ...json };
    } catch (e) {
      return scanDiagnosticsForAlarms(httpGetJson, cfg);
    }
  };
}


