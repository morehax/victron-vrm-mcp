import { z } from 'zod';

export const descriptor = {
  name: 'widget_fetch',
  description: 'Fetch VRM widgets by name (e.g., BatterySummary, GPS). Optional: instance. Returns notAvailable=true for unsupported widgets.',
  inputSchema: {
    type: 'object',
    properties: { widget: { type: 'string' }, instance: { type: 'number' } },
    additionalProperties: false,
  },
};

const Args = z.object({ widget: z.string().min(1), instance: z.number().int().nonnegative().optional() }).strict();

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler(argsRaw = {}) {
    const args = Args.parse(argsRaw ?? {});
    const params = new URLSearchParams();
    if (typeof args.instance === 'number') params.set('instance', String(args.instance));
    const qs = params.toString();
    const safeWidget = encodeURIComponent(args.widget);
    try {
      const json = await httpGetJson(`/installations/${cfg.siteId}/widgets/${safeWidget}${qs ? `?${qs}` : ''}`);
      return { source: 'vrm', ...json };
    } catch (e) {
      const msg = e?.message || '';
      if (typeof msg === 'string' && /\b404\b/.test(msg)) {
        return { source: 'vrm', success: false, notAvailable: true, widget: args.widget, message: 'Widget not available for this site.' };
      }
      throw e;
    }
  };
}


