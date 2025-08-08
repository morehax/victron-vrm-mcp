export function stableStringBytes(s) {
  return new TextEncoder().encode(s).length;
}

export function chunkJsonArrayEnvelope(items, makeEnvelope, maxBytes) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;

  for (const it of items) {
    const tentative = JSON.stringify(it);
    const itemBytes = new TextEncoder().encode(tentative).length;
    if (current.length > 0 && currentBytes + itemBytes > maxBytes) {
      chunks.push(current);
      current = [it];
      currentBytes = itemBytes;
    } else {
      current.push(it);
      currentBytes += itemBytes;
    }
  }
  if (current.length) chunks.push(current);

  return chunks.map((arr, index, all) => {
    const env = makeEnvelope(index, all.length);
    env.devices = arr;
    const bytes = new TextEncoder().encode(JSON.stringify(env)).length;
    env.chunk.bytes = bytes;
    return env;
  });
}


