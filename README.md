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

### Marketplace / Shop (`haszno_shop_*`)

The Haszno Shop (Hirdetési Piactér) is **completely free** — no listing or usage fees.
Reserving is not paying: payment and handover happen directly between buyer and seller.

**Read (no side effects)**
- `haszno_shop_list_categories` — full category taxonomy with required ad attributes
- `haszno_shop_search_ads` — search public ads (q, categoryId, minPrice, maxPrice, page, sort)
- `haszno_shop_get_ad` — single ad detail including the `reserved` flag
- `haszno_shop_price_hint` — suggested asking price for a category + keyword
- `haszno_shop_list_my_ads` — your own ads (filter by status: aktiv/fuggeszetett/eladva/lejart)
- `haszno_shop_list_inquiries` — messages buyers sent to your ads
- `haszno_shop_list_favorites` — your saved favorite ads
- `haszno_shop_list_reservations` — your reservations as buyer or seller

**Write (require authentication; create/reserve/complete require `confirm: true`)**
- `haszno_shop_upload_image` — upload a local file or base64 image, returns a URL
- `haszno_shop_suggest_from_photos` — AI pre-fill ad fields from uploaded image URLs
- `haszno_shop_create_ad` — post a new ad (validates required category attributes before sending) *(confirm: true)*
- `haszno_shop_update_ad` — edit an existing ad
- `haszno_shop_set_ad_status` — pause (`fuggeszetett`) or reactivate (`aktiv`) an ad
- `haszno_shop_mark_sold` — mark an ad sold (irreversible) *(confirm: true)*
- `haszno_shop_renew_ad` — bump an ad back to the top
- `haszno_shop_send_inquiry` — send a question to the seller
- `haszno_shop_set_favorite` — save or remove a favorite
- `haszno_shop_reserve_ad` — place a reservation on an ad (not a payment) *(confirm: true)*
- `haszno_shop_respond_reservation` — accept or decline a reservation (seller)
- `haszno_shop_cancel_reservation` — cancel your own reservation (buyer)
- `haszno_shop_complete_reservation` — mark a reservation fulfilled, closes the ad (seller, irreversible) *(confirm: true)*

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
