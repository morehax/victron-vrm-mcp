export function globToRegex(glob) {
  const escaped = glob
    .replace(/[-\/\\^$+.()|[\]{}]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function canonicalDeviceTypeFromDiagnostics(attr) {
  const svc = (attr.dbusServiceType || '').toLowerCase();
  switch (svc) {
    case 'vebus': return 'vebus';
    case 'battery':
    case 'bms': return 'battery_monitor';
    case 'solarcharger':
    case 'solar_charger':
    case 'solar': return 'solar_charger';
    case 'temperature':
    case 'tempsensor':
    case 'temperature_sensor': return 'temp_sensor';
    case 'alternator': return 'alternator';
    case 'system':
    case 'supervisor':
    case 'settings': return 'system';
    default:
      if (typeof attr.idDeviceType === 'number') return `type_${attr.idDeviceType}`;
      if (typeof attr.Device === 'string') {
        const mapped = canonicalDeviceTypeFromDeviceLabel(attr.Device);
        if (mapped) return mapped;
      }
      return 'unknown';
  }
}

export function canonicalDeviceTypeFromDeviceLabel(label) {
  const lc = String(label || '').toLowerCase();
  if (lc.includes('ve.bus')) return 'vebus';
  if (lc === 'vebus') return 'vebus';
  if (lc.includes('solar charger')) return 'solar_charger';
  if (lc.includes('battery monitor')) return 'battery_monitor';
  if (lc.includes('temperature')) return 'temp_sensor';
  if (lc.includes('alternator')) return 'alternator';
  if (lc === 'charger' || lc.includes('charger')) return 'charger';
  if (lc === 'system') return 'system';
  return null;
}

export function makeDeviceId(type, instance) {
  const inst = (instance === undefined || instance === null) ? '0' : String(instance);
  return `${type}:${inst}`;
}

export function getDiagnosticsRecords(diag) {
  if (diag && Array.isArray(diag.records)) return diag.records;
  return [];
}

export function canonicalDeviceTypeFromRecord(rec) {
  const svc = (rec.dbusServiceType || '').toLowerCase();
  switch (svc) {
    case 'vebus': return 'vebus';
    case 'battery':
    case 'bms': return 'battery_monitor';
    case 'solarcharger':
    case 'solar_charger':
    case 'solar': return 'solar_charger';
    case 'temperature':
    case 'tempsensor':
    case 'temperature_sensor': return 'temp_sensor';
    case 'alternator': return 'alternator';
    case 'system':
    case 'supervisor':
    case 'settings': return 'system';
    default:
      if (typeof rec.idDeviceType === 'number') return `type_${rec.idDeviceType}`;
      if (typeof rec.Device === 'string') {
        const mapped = canonicalDeviceTypeFromDeviceLabel(rec.Device);
        if (mapped) return mapped;
      }
      return 'unknown';
  }
}

export function deriveDeviceNameFromDiagnostics(diag, instance, expectedType) {
  const recs = getDiagnosticsRecords(diag).filter((r) => (
    r && typeof r === 'object' && r.instance === instance && canonicalDeviceTypeFromRecord(r) === expectedType
  ));
  if (!recs.length) return null;

  const candidates = [];
  const nameDescRx = /(custom\s*name|^name$|product\s*name|device\s*name)/i;
  const preferredHints = ['skylla', 'charger', 'mppt', 'multiplus', 'inverter', 'battery', 'sensor', 'alternator'];

  for (const r of recs) {
    const desc = (typeof r.description === 'string') ? r.description : '';
    const fv = (typeof r.formattedValue === 'string') ? r.formattedValue : '';
    if (!fv) continue;

    let score = 0;
    if (nameDescRx.test(desc)) score += 3;
    const lcfv = fv.toLowerCase();
    if (preferredHints.some((kw) => lcfv.includes(kw))) score += 2;
    if (/\s/.test(fv)) score += 1;
    if (fv.length >= 4) score += 1;

    candidates.push({ value: fv, score });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value, 'en'));
  return candidates[0].value;
}

export function signalIdFromDbusPath(dbusPath) {
  if (!dbusPath) return null;
  return `dbus:${dbusPath}`;
}

export function unitFromFormatWithUnit(formatWithUnit) {
  if (!formatWithUnit || typeof formatWithUnit !== 'string') return null;
  const parts = formatWithUnit.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const unit = parts[parts.length - 1];
  if (/^%/.test(unit)) return null;
  return unit;
}

export function coerceValueRecord(a) {
  const ts = (typeof a.timestamp === 'number') ? a.timestamp : null;

  const asNumber = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return null;
  };

  const num =
    asNumber(a.rawValue) ??
    asNumber(a.value) ??
    null;

  const unit = unitFromFormatWithUnit(a.formatWithUnit) ?? (a.unit || null);
  const dbusPath = a.dbusPath;

  if (num === null) {
    const text = (typeof a.formattedValue === 'string' && a.formattedValue) ||
                 (typeof a.textValue === 'string' && a.textValue) ||
                 null;
    return {
      kind: 'scalar',
      payload: {
        value: (text !== null ? text : (a.rawValue ?? a.value ?? null)),
        unit: unit,
        ts: ts,
        source: { dbusPath, ...(a.code ? { vrmCode: a.code } : {}) },
      }
    };
  } else {
    const text = (typeof a.formattedValue === 'string' && a.formattedValue) ||
                 (typeof a.textValue === 'string' && a.textValue) ||
                 null;
    if (text !== null && text !== '' && isNaN(Number(text))) {
      return {
        kind: 'state',
        payload: {
          state: { value: num, text },
          ts: ts,
          source: { dbusPath, ...(a.code ? { vrmCode: a.code } : {}) },
        }
      };
    }
    return {
      kind: 'scalar',
      payload: {
        value: num,
        unit: unit,
        ts: ts,
        source: { dbusPath, ...(a.code ? { vrmCode: a.code } : {}) },
      }
    };
  }
}


