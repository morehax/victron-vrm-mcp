import { z } from 'zod';

export const descriptor = {
  name: 'energy_stats_quick',
  description: 'Convenience wrapper over VRM /stats for common summaries (kind: solar|consumption). Defaults: interval=days, last 7 days, show_instance=true. Optional: autoFallback.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['solar', 'consumption'] },
      startTs: { type: 'number' },
      endTs: { type: 'number' },
      interval: { type: 'string', enum: ['hours', 'days'] },
      showInstances: { type: 'boolean' },
      autoFallback: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

const Args = z.object({
  kind: z.enum(['solar', 'consumption']).optional(),
  startTs: z.number().int().nonnegative().optional(),
  endTs: z.number().int().nonnegative().optional(),
  interval: z.enum(['hours', 'days']).optional(),
  showInstances: z.boolean().optional(),
  autoFallback: z.boolean().optional(),
}).strict();

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler(argsRaw = {}) {
    const parsed = Args.parse(argsRaw ?? {});
    const nowSec = Math.floor(Date.now() / 1000);
    const interval = parsed.interval || 'days';
    const endTs = parsed.endTs || nowSec;
    const defaultWindowSec = interval === 'days' ? 7 * 24 * 3600 : 24 * 3600;
    const startTs = parsed.startTs || (endTs - defaultWindowSec);
    const kind = parsed.kind || 'solar';
    const showInstances = parsed.showInstances ?? true;
    const autoFallback = parsed.autoFallback ?? true;

    async function fetchStats(kindArg, startArg, endArg, intervalArg) {
      const params = new URLSearchParams();
      params.set('type', kindArg);
      params.set('interval', intervalArg);
      params.set('start', String(startArg));
      params.set('end', String(endArg));
      if (showInstances) params.set('show_instance', 'true');
      const path = `/installations/${cfg.siteId}/stats?${params.toString()}`;
      return httpGetJson(path);
    }

    let result = await fetchStats(kind, startTs, endTs, interval);
    const isEmpty = !result || (Array.isArray(result.records) && result.records.length === 0) && (Array.isArray(result.totals) && result.totals.length === 0);
    if (isEmpty && autoFallback) {
      const widerStart = endTs - (interval === 'days' ? 30 * 24 * 3600 : 7 * 24 * 3600);
      result = await fetchStats(kind, widerStart, endTs, interval);
      const stillEmpty = !result || (Array.isArray(result.records) && result.records.length === 0) && (Array.isArray(result.totals) && result.totals.length === 0);
      if (stillEmpty && !parsed.kind) {
        const other = (kind === 'solar') ? 'consumption' : 'solar';
        result = await fetchStats(other, widerStart, endTs, interval);
      }
    }
    return result;
  };
}


