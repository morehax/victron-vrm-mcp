export const descriptor = {
  name: 'get_system_overview',
  description: 'High-level site snapshot from VRM system overview. Use first to understand device connectivity and key states.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export function makeHandler({ httpGetJson, cfg }) {
  return async function handler() {
    const data = await httpGetJson(`/installations/${cfg.siteId}/system-overview`);
    return data;
  };
}


