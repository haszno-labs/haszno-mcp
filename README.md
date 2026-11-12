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

## Authentication

The server resolves credentials in this order:

1. `HASZNO_API_TOKEN` — per-shop Bearer token (**canonical**; create at Haszno → Integráció → API-kulcsok)
2. `HASZNO_API_KEY` — legacy alias for `HASZNO_API_TOKEN` (silent migration; both are sent as `Authorization: Bearer`)
3. `ARFUTAR_API_KEY` — legacy alias (silent backwards-compatibility)
4. `HASZNO_BASIC` — HTTP Basic auth (session-based endpoints only)
5. `~/.config/haszno/config.json` — written by `haszno configure` in the CLI
6. `~/.config/arfutar/config.json` (silent backwards-compatibility)

### Creating a shop token

1. Log in to [haszno.com](https://haszno.com) → **Integráció → API-kulcsok**
2. Click **Új API-kulcs**, give it a name, select the **agent** scope
3. Copy the `haszno_…` token — it is shown only once
4. Set `HASZNO_API_TOKEN=haszno_…` in your environment

> **Scopes:** shop tokens have **read** access to products, orders, and pending proposals,
> and **write** access to create proposals (pending only).
> Approve / reject / rollback operations require human review through the web dashboard —
> this is by design (human-in-the-loop is mandatory for price changes).

> **Expiry:** tokens expire after the period shown in API-kulcsok. Generate a new one when it expires.

Config file format (flat, not profile-keyed):

```json
{
  "apiUrl": "https://haszno.com",
  "apiKey": "haszno_xxxx"
}
```

You can also configure this through the MCP server itself:

```
haszno_account_configure(apiUrl: "https://haszno.com", apiKey: "haszno_xxxx", confirm: true)
```

---

## Environment variables

| Variable | Description |
|---|---|
| `HASZNO_API_URL` | Base URL of your Haszno instance (default: `https://haszno.com`) |
| `HASZNO_API_TOKEN` | Per-shop Bearer token (**canonical**) — sent as `Authorization: Bearer` |
| `HASZNO_API_KEY` | Legacy alias for `HASZNO_API_TOKEN` — treated identically |

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
- `haszno_products_list` — list shop products with margin and recommended pricing (agent endpoint)
- `haszno_products_update` — *(not available with shop token — returns "not available" message)*
- `haszno_products_set_listing` — *(not available with shop token)*
- `haszno_products_apply_prices` — *(not available with shop token)*
- `haszno_products_ai_description` — *(not available with shop token)*

### Price proposals (`haszno_proposals_*`)
- `haszno_proposals_list` — list pending proposals (agent endpoint; pending only)
- `haszno_proposals_market` — proposal + product context (agent endpoint)
- `haszno_proposals_create` — create a pending proposal with auto-generated nonce (agent endpoint)
- `haszno_proposals_approve` — *(not available with shop token — human review required)*
- `haszno_proposals_reject` — *(not available with shop token — human review required)*
- `haszno_proposals_rollback` — *(not available with shop token — human review required)*
- `haszno_proposals_reject` — reject proposals
- `haszno_proposals_rollback` — roll back a batch

### Automation / Rules (`haszno_rules_*`, `haszno_automation_*`)
- `haszno_rules_list_templates` — rule templates
- `haszno_rules_list` / `haszno_rules_create` / `haszno_rules_update` / `haszno_rules_delete`
- `haszno_rules_run` / `haszno_rules_run_all` / `haszno_rules_trigger`
- `haszno_rules_list_runs` / `haszno_rules_undo_unlists`
- `haszno_automation_get` / `haszno_automation_set`

### Orders (`haszno_orders_*`)
- `haszno_orders_list` — last 20 orders via agent endpoint (id, customerName, status, totalGross, items)
- `haszno_orders_get` — one order with line items (agent endpoint)
- `haszno_orders_ship` — *(not available with shop token)*
- `haszno_orders_receive` — *(not available with shop token)*
- `haszno_orders_create_demo` — *(not available with shop token)*

### Feeds (`haszno_feeds_*`)
- `haszno_feeds_import_supplier` — import a supplier feed
- `haszno_feeds_import_market` — import market prices
- `haszno_feeds_outbound_info` — published outbound feed URLs

### Product ideas (`haszno_ideas_*`)
- `haszno_ideas_list` — trend-scored product ideas
- `haszno_ideas_ai_shortlist` — AI-curated shortlist
- `haszno_ideas_ai_description` — AI product description generator
- `haszno_ideas_fill_keywords` — fill missing trend keywords

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
