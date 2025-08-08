import { z } from 'zod';

export const descriptor = {
  name: 'widget_list_available',
  description: 'Probe availability of selected VRM widgets. Defaults to BatterySummary, GPS, Overview, or pass a custom list.',
  inputSchema: {
    type: 'object',
    properties: { widgets: { type: 'array', items: { type: 'string' } } },
    additionalProperties: false,
  },
};

const Args = z.object({ widgets: z.array(z.string()).optional() }).strict();

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler(argsRaw = {}) {
    const args = Args.parse(argsRaw ?? {});
    const candidates = (Array.isArray(args.widgets) && args.widgets.length)
      ? args.widgets
      : ['BatterySummary', 'GPS', 'Overview'];

    const results = await Promise.all(candidates.map(async (w) => {
      const safe = encodeURIComponent(w);
      try {
        const json = await httpGetJson(`/installations/${cfg.siteId}/widgets/${safe}`);
        return { widget: w, available: true, sample: { success: json?.success ?? undefined } };
      } catch (e) {
        const msg = e?.message || '';
        const notFound = typeof msg === 'string' && /\b404\b/.test(msg);
        return { widget: w, available: false, reason: notFound ? 'not_found' : 'error' };
      }
    }));

    return { ok: true, widgets: results };
  };
}


