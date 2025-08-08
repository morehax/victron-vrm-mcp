import { z } from 'zod';
import { globToRegex } from '../lib/vrm-utils.mjs';

export const descriptor = {
  name: 'resolve_device_selectors',
  description: 'Resolve selectors (names/globs/aliases) to deviceIds. Priority: exact deviceId → exact name → strict glob (id/name) → substring/aliases → product-class aliases.',
  inputSchema: {
    type: 'object',
    properties: { selectors: { type: 'array', items: { type: 'string' } } },
    additionalProperties: false,
  },
};

const Args = z.object({ selectors: z.array(z.string()) }).strict();

export function makeHandler({ tool_diagnostics_index, tool_device_inventory, tool_get_system_overview, tool_widget_list_available }) {
  return async function handler(argsRaw = {}) {
    const args = Args.parse(argsRaw ?? {});
    const selectors = args.selectors || [];

    const envelopes = await tool_diagnostics_index({});
    const catalog = [];
    for (const env of envelopes) {
      const devices = Array.isArray(env?.devices) ? env.devices : [];
      for (const d of devices) catalog.push({ deviceId: d.deviceId, type: d.type, instance: d.instance, name: (typeof d.name === 'string' ? d.name : null) });
    }
    try {
      const inv = await tool_device_inventory({});
      const nameById = new Map();
      const invDevices = Array.isArray(inv?.devices) ? inv.devices : [];
      for (const d of invDevices) if (d && d.deviceId) nameById.set(d.deviceId, (typeof d.name === 'string' ? d.name : null));
      for (const item of catalog) if ((!item.name || item.name === '') && nameById.has(item.deviceId)) item.name = nameById.get(item.deviceId) || item.name;
    } catch (_) { /* ignore */ }

    const typeAliases = new Map([
      ['solar_charger', ['mppt', 'solar charger', 'solar', 'charger']],
      ['vebus', ['vebus', 'inverter', 'multiplus']],
      ['type_106', ['skylla', 'dc charger', 'charger']],
      ['charger', ['skylla', 'dc charger', 'charger']],
      ['battery_monitor', ['battery', 'bms', 'battery monitor']],
      ['temp_sensor', ['temperature', 'temp', 'sensor', 'temperature sensor']],
      ['alternator', ['alternator']],
    ]);
    const classAliasToTypes = new Map([
      ['mppt', ['solar_charger']],
      ['multiplus', ['vebus']],
      ['inverter', ['vebus']],
      ['skylla', ['type_106', 'charger']],
    ]);

    // Dynamically enrich aliases and optionally inject virtual devices based on site data
    try {
      const [overview, widgetsInfo] = await Promise.all([
        tool_get_system_overview ? tool_get_system_overview({}) : null,
        tool_widget_list_available ? tool_widget_list_available({ widgets: ['GPS'] }) : null,
      ]);

      // 1) Enrich aliases from system overview product names/custom names
      const ovDevices = Array.isArray(overview?.records?.devices) ? overview.records.devices : [];
      const pushAlias = (type, val) => {
        if (!val || !type) return;
        const lc = String(val).trim().toLowerCase();
        if (!lc) return;
        if (!typeAliases.has(type)) typeAliases.set(type, []);
        const arr = typeAliases.get(type);
        if (!arr.includes(lc)) arr.push(lc);
      };
      const guessTypeFromOverview = (dev) => {
        const product = String(dev?.productName || dev?.name || '').toLowerCase();
        const klass = String(dev?.class || '').toLowerCase();
        if (/smartsolar|mppt/.test(product)) return 'solar_charger';
        if (/quattro|multiplus|ve\.bus|vebus/.test(product) || /device-ve-bus/.test(klass)) return 'vebus';
        if (/lynx|bms/.test(product)) return 'battery_monitor';
        if (/ruuvi|temperature/.test(product) || /temperature/.test(klass)) return 'temp_sensor';
        if (/wakespeed|ws500|alternator/.test(product)) return 'alternator';
        if (/skylla/.test(product)) return 'charger';
        if (/cerbo\s*gx|gateway/.test(product) || /device-gateway/.test(klass)) return 'gateway';
        return null;
      };
      for (const dev of ovDevices) {
        const t = guessTypeFromOverview(dev);
        if (t) {
          pushAlias(t, dev.productName);
          pushAlias(t, dev.customName);
          // Common brand/model tokens as extra aliases
          const extraTokens = [];
          const pn = String(dev.productName || '');
          if (/Cerbo\s*GX/i.test(pn)) extraTokens.push('cerbo', 'cerbo gx', 'gateway');
          if (/Quattro/i.test(pn)) extraTokens.push('quattro');
          if (/SmartSolar/i.test(pn)) extraTokens.push('smartsolar');
          if (/Lynx/i.test(pn)) extraTokens.push('lynx');
          if (/Wakespeed|WS500/i.test(pn)) extraTokens.push('wakespeed', 'ws500');
          for (const tok of extraTokens) pushAlias(t, tok);
        }
      }

      // 2) Inject virtual devices for GPS and Gateway so selectors resolve without hardcoding IDs
      // GPS virtual device if widget is available
      const gpsAvailable = Array.isArray(widgetsInfo?.widgets)
        ? widgetsInfo.widgets.some(w => String(w.widget).toUpperCase() === 'GPS' && w.available)
        : false;
      if (gpsAvailable) {
        catalog.push({ deviceId: 'gps:0', type: 'gps', instance: 0, name: 'GPS' });
        typeAliases.set('gps', ['gps']);
      }
      // Gateway/Cerbo virtual device if present in overview
      const cerbo = ovDevices.find(d => /cerbo\s*gx/i.test(String(d?.productName)) || /device-gateway/.test(String(d?.class)));
      if (cerbo) {
        const gName = cerbo.productName || cerbo.name || 'Gateway';
        catalog.push({ deviceId: 'gateway:0', type: 'gateway', instance: 0, name: gName });
        typeAliases.set('gateway', ['gateway', 'cerbo', 'cerbo gx']);
      }
    } catch (_) {
      // Best-effort enrichment; ignore failures
    }

    function byStableOrder(a, b) {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      const ai = a.instance ?? 0, bi = b.instance ?? 0;
      if (ai !== bi) return ai - bi;
      const an = a.name || '', bn = b.name || '';
      return an.localeCompare(bn, 'en');
    }
    function normalizeLower(s) { return String(s || '').toLowerCase(); }
    function collapseSpacesLower(s) { return normalizeLower(s).replace(/\s+/g, ''); }
    function collapseNonWordLower(s) { return normalizeLower(s).replace(/[^a-z0-9]+/g, ''); }

    function matchSelector(sel) {
      const matches = new Map();
      const raw = sel;
      const norm = String(sel || '').trim();
      if (!norm) return [];
      const lc = norm.toLowerCase();
      const lcNoSpace = lc.replace(/\s+/g, '');
      const lcNoPunct = lc.replace(/[^a-z0-9]+/g, '');

      for (const d of catalog) { if (norm === d.deviceId) { matches.set(d.deviceId, d); } }
      if (matches.size) return Array.from(matches.values()).sort(byStableOrder);

      for (const d of catalog) {
        if (!d.name) continue;
        const nameLc = normalizeLower(d.name);
        const nameNoSpace = collapseSpacesLower(d.name);
        const nameNoPunct = collapseNonWordLower(d.name);
        if (nameLc === lc || nameNoSpace === lcNoSpace || nameNoPunct === lcNoPunct) matches.set(d.deviceId, d);
      }
      if (matches.size) return Array.from(matches.values()).sort(byStableOrder);

      const isGlob = /[\*\?]/.test(norm);
      if (isGlob) {
        const rx = globToRegex(norm);
        const rxCollapsed = globToRegex(lcNoSpace);
        const rxNoPunct = globToRegex(lcNoPunct);
        for (const d of catalog) {
          if (rx.test(d.deviceId) || (d.name && rx.test(d.name)) || (d.name && rxCollapsed.test(collapseSpacesLower(d.name))) || (d.name && rxNoPunct.test(collapseNonWordLower(d.name)))) matches.set(d.deviceId, d);
        }
      }
      if (matches.size) return Array.from(matches.values()).sort(byStableOrder);
      if (isGlob) return [];

      for (const d of catalog) {
        const aliases = typeAliases.get(d.type) || [];
        const hayName = (d.name || '').toLowerCase();
        const hayNameCollapsed = collapseSpacesLower(d.name || '');
        const hayNameNoPunct = collapseNonWordLower(d.name || '');
        const aliasHit = aliases.some(a => a.includes(lc) || lc.includes(a));
        if ((hayName && (hayName.includes(lc) || hayNameCollapsed.includes(lcNoSpace) || hayNameNoPunct.includes(lcNoPunct))) || aliasHit) matches.set(d.deviceId, d);
      }
      if (matches.size) return Array.from(matches.values()).sort(byStableOrder);

      if (classAliasToTypes.has(lc)) {
        const targetTypes = classAliasToTypes.get(lc) || [];
        for (const d of catalog) if (targetTypes.includes(d.type)) matches.set(d.deviceId, d);
      }
      return Array.from(matches.values()).sort(byStableOrder);
    }

    const resolved = [];
    const unmatched = [];
    for (const sel of selectors) {
      const matches = matchSelector(sel).map(d => ({ deviceId: d.deviceId, type: d.type, instance: d.instance, ...(d.name ? { name: d.name } : {}) }));
      if (matches.length === 0) unmatched.push(sel);
      resolved.push({ selector: sel, matches });
    }

    return { ok: true, schemaVersion: '0.1', capture: { siteId: Number(process.env.VRM_SITE_ID), ts: Math.floor(Date.now() / 1000) }, resolved, unmatched };
  };
}


