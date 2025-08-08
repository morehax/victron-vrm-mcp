## VRM MCP Server

An MCP server that exposes Victron VRM data as tools your AI/dev environment can call. Version `0.6.0`.

### Highlights
- **System overview, diagnostics index/values, device inventory, alarms**
- **Historical values** and quick energy stats (solar/consumption)
- **Widgets** (Battery summary, GPS; generic widget fetch)
- **Smart device selector resolution** with exact/glob/fuzzy rules
- **Chunked responses** and strict error handling

### Use cases
- **Ask questions** like: “What’s my last GPS position?”, “Which alarms are active?”
- **Explore devices** and their signals interactively
- **Pull time-series** (e.g., PV power/voltage) for charts or analytics
- **Build automations** with predictable device selection using globs and aliases

## How it works
The server connects to Victron VRM REST endpoints using an access token and site id you provide via environment variables. It exposes a set of MCP tools over stdio. Your MCP-capable client (e.g., Cursor) discovers the tools and can call them with structured arguments.

### Tools exposed
| Tool | Description |
| --- | --- |
| `get_system_overview` | High-level site snapshot from VRM system overview. |
| `diagnostics_index` | Discover devices and dbus signals from diagnostics (chunked). Filters: `include`, `devices`, `types`, `maxChunkBytes`. |
| `diagnostics_values` | Current values for diagnostics signals (chunked). Filters: `include`, `devices`, `types`, `sinceTs`, `maxChunkBytes`. |
| `device_inventory` | List devices (type, instance, name). Optional filters: `types`, `devices`. |
| `alarms` | Active alarms (official VRM). Falls back to scanning diagnostics `/Alarms/*`. Optional: `sinceTs`. |
| `historical_values` | Time-series via VRM `/stats` `type=custom`. Accepts VRM codes and `dbus:/...` signals (auto-mapped). |
| `energy_stats_quick` | Convenience `/stats` wrapper for solar/consumption. Defaults: interval=days, last 7 days, `show_instance=true`. Optional: `autoFallback`. |
| `gps` | Last-known GPS (VRM widget). Falls back to diagnostics GPS signals. Optional: `instance`. |
| `battery_summary` | Battery summary (VRM widget). SoC, voltage, current, power, time-to-go, alarm flags. Optional: `instance`. |
| `widget_fetch` | Fetch VRM widgets by name (e.g., `BatterySummary`, `GPS`). Optional: `instance`. Returns `notAvailable=true` if unsupported. |
| `widget_list_available` | Probe availability of selected widgets. Defaults to `BatterySummary`, `GPS`, `Overview` or pass a list. |
| `resolve_device_selectors` | Resolve selectors (names/globs/aliases) to `deviceId`s. Priority: exact id → exact name → strict glob → substring/aliases → class aliases. |

## Requirements
- Node.js `>= 18`
- A VRM access token and site id

## Installation
```bash
git clone <your-repo-url>
cd VRM
npm install
```

## Configuration
Set the following environment variables (e.g., in a `.env` file):
- `VRM_API_TOKEN` (required): your VRM access token. Use the `Token <value>` format internally; provide only the raw token here.
- `VRM_SITE_ID` (required): numeric site id.
- `VRM_AUTH_HEADER` (optional, default `X-Authorization`): header used for auth.

Example `.env`:
```ini
VRM_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx
VRM_SITE_ID=123456
VRM_AUTH_HEADER=X-Authorization
```

## Running
```bash
npm start
```
On Windows, you can also use `start.bat`.

Your MCP client (e.g., Cursor) should auto-discover the server over stdio. If you need to configure it manually, add an entry similar to:
```json
{
  "mcpServers": {
    "vrm-mcp": {
      "command": "node",
      "args": ["server.mjs"],
      "env": {
        "VRM_API_TOKEN": "${env:VRM_API_TOKEN}",
        "VRM_SITE_ID": "${env:VRM_SITE_ID}",
        "VRM_AUTH_HEADER": "X-Authorization"
      }
    }
  }
}
```

## Usage examples

### Device inventory
List all devices (types, instances, names):
```json
{
  "name": "device_inventory",
  "arguments": {}
}
```

### Resolve selectors
- Non-glob (fuzzy allowed):
  - `"skylla"` → resolves to the Skylla DC charger (`charger:0`).
  - `"PORTFWD"` → matches `PORT FWD` even without spaces.
- Glob (strict, id/name only):
  - `"vebus:*"` → all vebus devices by id.
  - `"solar_charger:29?"` → `solar_charger:290..295`.
  - `"PORT *"` → all devices whose name starts with `PORT` (whitespace- and punctuation-insensitive).

```json
{
  "name": "resolve_device_selectors",
  "arguments": { "selectors": ["vebus:*", "PORTFWD", "skylla"] }
}
```

### Diagnostics values (filtered)
Fetch current PV power and voltage signals across devices:
```json
{
  "name": "diagnostics_values",
  "arguments": {
    "include": ["dbus:/Yield/Power", "dbus:/Pv/V"]
  }
}
```

### Historical values
Pull time-series for PV power (`PVP`) and PV voltage (`PVV`) for a time window. You can mix VRM codes and `dbus:/...` signals; `dbus:/...` will be mapped automatically.
```json
{
  "name": "historical_values",
  "arguments": {
    "signals": ["PVP", "PVV", "dbus:/Yield/Power"],
    "startTs": 1700000000,
    "endTs": 1700086400,
    "resolution": "hours"
  }
}
```

### Battery summary (widget)
```json
{ "name": "battery_summary", "arguments": {} }
```

### Energy stats quick
```json
{ "name": "energy_stats_quick", "arguments": { "kind": "consumption", "interval": "days" } }
```

### GPS (widget)
```json
{ "name": "gps", "arguments": {} }
```

### Widget utilities
```json
{ "name": "widget_list_available", "arguments": {} }
```
```json
{ "name": "widget_fetch", "arguments": { "widget": "BatterySummary" } }
```

## Selector matching rules
- **Order**: exact deviceId → exact name (case/whitespace/punctuation-insensitive) → glob (case-insensitive; also tries collapsed variants) → substring/aliases → product-class aliases.
- **Glob is strict**: if a selector contains `*` or `?`, only id/name globbing is used. If no match, it will not fall back to aliases or substring matches.
- **Aliases**: map common phrases to types (e.g., `mppt` → `solar_charger`, `multiplus` → `vebus`, `skylla` → `charger`/`type_106`).

## Troubleshooting
- **401 Unauthorized**: verify `VRM_API_TOKEN` and `VRM_AUTH_HEADER`. The token should be valid and not expired. Ensure you’re using an access token (format `Token <value>` on the wire; raw value in env).
- **403/404**: confirm `VRM_SITE_ID` is correct and the token has access to that site.
- **429 Rate limited**: VRM enforces rolling-window limits. Back off and retry (see `Retry-After` response header when available).
- **Timeouts**: default request timeout is 15s. Check connectivity; reduce payload size using `include`, `devices`, or `types` filters.
- **Empty GPS**: if diagnostics don’t expose GPS, try VRM GPS widget endpoints or verify the device is configured to publish GPS.

## Security notes
- Tokens are read from environment and never logged.
- Error responses include a short snippet of the VRM response (never your token).
- Consider storing the token in your system keychain and exporting it per-shell instead of committing `.env` files.

## Development
- Entry: `server.mjs` (thin orchestrator)
- Tools: `src/tools/*.mjs`
- Helpers: `src/lib/*` (chunking, vrm utils), HTTP in `src/http.mjs`, config in `src/config.mjs`
- Validation: `zod`; HTTP: `undici`

## License
Choose and add a license (e.g., MIT) before public release.


