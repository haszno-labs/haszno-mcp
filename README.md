# @haszno/mcp

**English** | [Magyar](README.hu.md)

**Haszno MCP Server** — for Claude and other MCP-compatible AI agents.

The server runs on stdio transport and exposes the Haszno pricing platform: products, price proposals, automation rules, orders, supplier catalog, and product ideas.

---

## Related repos

| Repo | Description |
|---|---|
| [`haszno-labs/haszno-cli`](https://github.com/haszno-labs/haszno-cli) | Command-line client (`haszno login`, `haszno products list`, ...) |
| [`haszno-labs/haszno-mcp`](https://github.com/haszno-labs/haszno-mcp) | This repo — MCP server for Claude Code |
| [`haszno-labs/haszno-skill`](https://github.com/haszno-labs/haszno-skill) | Claude Code skill — context and workflow patterns |

Install all three at once with the **install script**:

```bash
curl -fsSL https://raw.githubusercontent.com/haszno-labs/haszno-skill/main/install.sh | bash
```

---

## Installation

### npx (once published — no cloning needed)

```bash
claude mcp add haszno -- npx -y github:haszno-labs/haszno-mcp
```

### Local install (current)

```bash
# 1. Clone
git clone https://github.com/haszno-labs/haszno-mcp ~/.haszno/haszno-mcp
cd ~/.haszno/haszno-mcp

# 2. Build
npm install
npm run build

# 3. Register with Claude Code
claude mcp add haszno -- node ~/.haszno/haszno-mcp/dist/index.js
```

---

## Authentication — two modes

The server supports two credential modes. The mode is selected automatically based on
the credential you provide.

### Mode 1 — Shop token (agent access, `haszno_` prefix)

Shop tokens start with `haszno_` and grant access to the **agent endpoints**:
read products, read orders, read and **submit** proposals. Everything else
(settings, automation rules, feeds, catalog management, …) is blocked and
returns an error immediately with no HTTP call.

Shop tokens are issued in the Haszno web app → **API-kulcsok**:
- Scopes: `read` (GET) and/or `write` (submit proposals)
- Expiry: 90 days; renewal requires human approval
- Human-only approval: the shop owner must accept each token request in the web app

Set the token with the **preferred** env var:

```bash
export HASZNO_API_TOKEN=haszno_xxxxxxxxxxxxxxxxxxxx
```

### Mode 2 — Legacy API key (full access)

Any credential that does **not** start with `haszno_` (plain API keys, HTTP Basic)
is forwarded via `x-api-key` or `Authorization: Basic` exactly as before.
All tools and operations are available.

### Credential resolution order

1. `HASZNO_API_TOKEN` — preferred for shop tokens
2. `HASZNO_API_KEY` / `ARFUTAR_API_KEY` — also accepted (shop token or legacy key)
3. `~/.config/haszno/config.json` — written by `haszno configure` in the CLI
4. `~/.config/arfutar/config.json` (silent backwards-compatibility)

Config file format (flat, not profile-keyed):

```json
{
  "apiUrl": "https://haszno.com",
  "apiKey": "haszno_xxxx"
}
```

You can also configure credentials through the MCP server itself:

```
haszno_account_configure(apiUrl: "https://haszno.com", apiKey: "haszno_xxxx", confirm: true)
```

---

## Environment variables

| Variable | Description |
|---|---|
| `HASZNO_API_URL` | Base URL of your Haszno instance (default: `https://haszno.com`) |
| `HASZNO_API_TOKEN` | Shop token (preferred; for `haszno_` prefixed tokens) |
| `HASZNO_API_KEY` | API key — shop token or legacy key |

---

## Tools

### Account (`haszno_account_*`)
- `haszno_ping` — check connectivity
- `haszno_account_get_settings` — fetch pricing rules
- `haszno_account_update_settings` — update pricing rules
- `haszno_account_get_stats` — shop summary
- `haszno_account_get_impact` — profit meter (N days)
- `haszno_account_list_suppliers` — list connected suppliers
- `haszno_account_configure` — save API credentials

### Supplier catalog (`haszno_catalog_*`)
- `haszno_catalog_list_categories` — browse categories
- `haszno_catalog_list_suppliers` — browse partner suppliers
- `haszno_catalog_supplier_products` — list a supplier's products
- `haszno_catalog_supplier_view` — market statistics for a supplier
- `haszno_catalog_connect_supplier` — connect a supplier
- `haszno_catalog_sync_supplier` — sync a supplier

### Products (`haszno_products_*`)
- *(coming soon)*

### Price proposals (`haszno_proposals_*`)
- `haszno_proposals_list` — list / paginate proposals
- `haszno_proposals_market` — proposal + market context
- `haszno_proposals_approve` — approve proposals *(legacy key only)*
- `haszno_proposals_reject` — reject proposals *(legacy key only)*
- `haszno_proposals_rollback` — roll back a batch *(legacy key only)*
- `haszno_proposals_propose` — submit a new price proposal *(shop token + write scope)*

### Automation / Rules (`haszno_rules_*`, `haszno_automation_*`)
- `haszno_rules_list_templates` — rule templates
- `haszno_rules_list` / `haszno_rules_create` / `haszno_rules_update` / `haszno_rules_delete`
- `haszno_rules_run` / `haszno_rules_run_all` / `haszno_rules_trigger`
- `haszno_rules_list_runs` / `haszno_rules_undo_unlists`
- `haszno_automation_get` / `haszno_automation_set`

### Orders (`haszno_orders_*`)
- `haszno_orders_list` / `haszno_orders_get`
- `haszno_orders_ship` / `haszno_orders_receive`
- `haszno_orders_create_demo` *(demo environment only)*

### Feeds (`haszno_feeds_*`)
- `haszno_feeds_import_supplier` — import a supplier feed
- `haszno_feeds_import_market` — import market prices
- `haszno_feeds_outbound_info` — published outbound feed URLs

### Product ideas (`haszno_ideas_*`)
- `haszno_ideas_list` — trend-scored product ideas
- `haszno_ideas_ai_shortlist` — AI-curated shortlist
- `haszno_ideas_ai_description` — AI product description generator
- `haszno_ideas_fill_keywords` — fill missing trend keywords

### Daily market report + agent actions (`haszno_daily_report`, `haszno_research_brief`, `haszno_post_findings`, `haszno_list_actions`, `haszno_propose_action`)

| Tool | Description |
|---|---|
| `haszno_daily_report` | Get the daily market report (latest or by date). Set `list: true` for a summary of the last 30 days. Read-only. |
| `haszno_research_brief` | Get today's research brief: shop focus keywords/products with prices and trend indicators, Hungarian research questions, and the `postTo` URL to deliver findings. Read-only. |
| `haszno_post_findings` | Post research findings for today (or yesterday). Items are added to the report as `origin: 'agent'`. Max 20 items per call, 60 per day. |
| `haszno_list_actions` | List proposed and executed agent actions. Filter by status. Read-only. |
| `haszno_propose_action` | Propose an action (felvetel/levetel/ar/import) for the shop owner to review. The price floor is enforced by the server; approve/undo are always the shop owner's decision in the Haszno UI. |

> **Approve and undo are intentionally NOT tools** — they require human decision-making and are handled by the shop owner in the Haszno interface.

#### Napi kutatás — example workflow

```
// 1. Get the research brief for today
haszno_research_brief()
// → { day: "2026-11-12", shopFocus: [...], questions: [...], postTo: "/api/daily-reports/2026-11-12/findings" }

// 2. Research the market based on shopFocus and questions
// (search the web, check supplier news, etc.)

// 3. Post findings
haszno_post_findings({
  day: "2026-11-12",
  headline: "PS5 Pro ára 10%-ot emelkedett",
  items: [
    {
      kind: "hir",
      title: "PS5 Pro ára emelkedett",
      body: "A Sony bejelentette, hogy a PS5 Pro ajánlott kiskereskedelmi ára 10%-ot emelkedik 2026 decemberétől.",
      changePct: 10.0,
      keyword: "PS5 Pro",
      sourceName: "Sony Newsroom",
      sourceUrl: "https://blog.sony.com/ps5pro-price",
      suggestedAction: { type: "ar", productId: 42, priceGross: 269990 }
    }
  ]
})
// → Updated DailyReport (the shop owner sees the item and the suggested price action)

// 4. Optionally propose additional actions
haszno_propose_action({
  type: "ar",
  productId: 42,
  priceGross: 269990,
  reason: "Sony announced a 10% RRP increase; market minimum already rising."
})
// → AgentAction { status: "javasolt" } — waiting for the owner to approve
```

---

## Development

```bash
npm install
npm run build      # tsup build
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

---

## Documentation

Full developer docs: [https://docs.haszno.com/en/](https://docs.haszno.com/en/)

---

## License

MIT — Copyright (c) 2026 Haszno Labs
