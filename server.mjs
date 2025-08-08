#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { cfg } from './src/config.mjs';
import { httpGetJson } from './src/http.mjs';

// Tool modules
import * as mod_get_system_overview from './src/tools/get_system_overview.mjs';
import * as mod_diagnostics_index from './src/tools/diagnostics_index.mjs';
import * as mod_diagnostics_values from './src/tools/diagnostics_values.mjs';
import * as mod_device_inventory from './src/tools/device_inventory.mjs';
import * as mod_alarms from './src/tools/alarms.mjs';
import * as mod_historical_values from './src/tools/historical_values.mjs';
import * as mod_gps from './src/tools/gps.mjs';
import * as mod_battery_summary from './src/tools/battery_summary.mjs';
import * as mod_energy_stats_quick from './src/tools/energy_stats_quick.mjs';
import * as mod_widget_fetch from './src/tools/widget_fetch.mjs';
import * as mod_widget_list_available from './src/tools/widget_list_available.mjs';
import * as mod_resolve_device_selectors from './src/tools/resolve_device_selectors.mjs';

function asHostContent(payload) {
  return [{ type: 'text', text: JSON.stringify(payload) }];
}

// Build tool registry
const toolModules = [
  mod_get_system_overview,
  mod_battery_summary,
  mod_diagnostics_index,
  mod_diagnostics_values,
  mod_device_inventory,
  mod_alarms,
  mod_historical_values,
  mod_energy_stats_quick,
  mod_gps,
  mod_resolve_device_selectors,
  mod_widget_fetch,
  mod_widget_list_available,
];

const toolDescriptors = [];
const toolHandlers = new Map();

// Pre-register specific handlers needed as dependencies
const diagnosticsIndexHandler = mod_diagnostics_index.makeHandler({ httpGetJson, cfg });
const deviceInventoryHandler = mod_device_inventory.makeHandler({ httpGetJson, cfg });

for (const mod of toolModules) {
  if (!mod?.descriptor?.name) continue;
  toolDescriptors.push(mod.descriptor);
  let handler;
  if (mod === mod_resolve_device_selectors) {
    // Pre-wire additional helpers used for dynamic aliasing
    const getSystemOverviewHandler = mod_get_system_overview.makeHandler({ httpGetJson, cfg });
    const widgetListAvailableHandler = mod_widget_list_available.makeHandler({ httpGetJson, cfg });
    handler = mod.makeHandler({
      tool_diagnostics_index: diagnosticsIndexHandler,
      tool_device_inventory: deviceInventoryHandler,
      tool_get_system_overview: getSystemOverviewHandler,
      tool_widget_list_available: widgetListAvailableHandler,
    });
  } else if (mod === mod_diagnostics_index) {
    handler = diagnosticsIndexHandler;
  } else if (mod === mod_device_inventory) {
    handler = deviceInventoryHandler;
  } else {
    handler = mod.makeHandler({ httpGetJson, cfg });
  }
  toolHandlers.set(mod.descriptor.name, handler);
}

// MCP server wiring
const server = new Server(
  { name: 'vrm-mcp', version: '0.6.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDescriptors }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: argsRaw = {} } = req.params;
  try {
    if (toolHandlers.has(name)) {
      const payload = await toolHandlers.get(name)(argsRaw);
      if (Array.isArray(payload) && payload.length && payload[0]?.chunk) {
        return { content: payload.flatMap((env) => asHostContent(env)) };
      }
      return { content: asHostContent(payload) };
    }
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (e) {
    if (e?.__mcp) {
      return {
        isError: true,
        content: [{ type: 'text', text: `${e.message}` }],
        error: { code: e.__mcp.code, message: e.message, data: e.__mcp.data },
      };
    }
    const msg = e?.message || String(e);
    return { isError: true, content: [{ type: 'text', text: `Unexpected error: ${msg}` }], error: { code: -32001, message: msg } };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[VRM MCP] Ready on stdio. Tools:', toolDescriptors.map(t => t.name).join(', '));


