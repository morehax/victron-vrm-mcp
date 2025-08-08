import { z } from 'zod';

export const descriptor = {
  name: 'battery_summary',
  description: 'Battery summary via VRM widget. Returns SoC, voltage, current, power, time-to-go, and alarm flags. Optional: instance.',
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
    const qs = params.toString();
    const json = await httpGetJson(`/installations/${cfg.siteId}/widgets/BatterySummary${qs ? `?${qs}` : ''}`);
    return { source: 'vrm', ...json };
  };
}


