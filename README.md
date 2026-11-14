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

### Identity & token (`haszno_account_whoami`, `haszno_auth_*`)
- `haszno_account_whoami` — returns id, email, shopId, shopName, role, **tokenScope** (read/write); works with all credential modes; recommended first call
- `haszno_auth_revoke_token` — permanently revokes the current Bearer token; Bearer only; requires `confirm: true`

### Account (`haszno_account_*`, `haszno_ping`)
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
- `haszno_products_list` — list shop products with price, margin, stock; shop token calls `/api/agent/products` (includes `recommended.floorGross`), legacy calls `/api/products`; supports `all=true` in legacy mode
- `haszno_products_update` — update market price / competitor name / direct price override *(legacy key only)*
- `haszno_products_set_listing` — list or unlist a product *(legacy key only)*
- `haszno_products_apply_prices` — apply AI-recommended prices immediately *(legacy key only)*; shop token users: use `haszno_proposals_propose` instead
- `haszno_products_ai_description` — generate an AI product description *(legacy key only)*

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
- `haszno_shop_list_categories` — full category taxonomy (categories with `key`, `attrs` per category, `conditions`, `counties`)
- `haszno_shop_search_ads` — search public ads (`q`, `cat`, `sub`, `min`, `max`, `county`, `city`, `cond`, `sort`, `page`); sort values: `uj` (newest), `ar_nov` (price asc), `ar_csokk` (price desc)
- `haszno_shop_get_ad` — single ad detail including the `reserved` flag
- `haszno_shop_price_hint` — suggested price range (p25–p75) for a `cat` (category key) and optional `sub` subcategory key
- `haszno_shop_list_my_ads` — your own non-deleted ads
- `haszno_shop_list_inquiries` — messages buyers sent to your ads (`adId?`, `limit`, `offset`)
- `haszno_shop_list_favorites` — your saved favorite ads
- `haszno_shop_list_reservations` — your reservations as `buyer` (default) or `seller`; response includes `counterPriceGross` (seller counter-offer), `agreedPriceGross` (mutually agreed price), and `sellerRating` (buyer's rating of seller after completion)
- `haszno_shop_list_messages` — messages in a reservation thread (`id` = reservation ID); response items include `author` (`buyer`|`seller`), `body`, `createdAt`
- `haszno_shop_list_saved_searches` — your saved searches with alert settings; returns `{ id, name, filters, alertEnabled, lastAlertSentAt, createdAt }[]`
- `haszno_shop_get_draft` — fetch your in-progress ad draft (returns `null` if none exists)

**Write (require authentication; destructive actions require `confirm: true`)**
- `haszno_shop_upload_image` — upload a local file (`filePath`) or base64 image (`base64` + `mimeType`), max 700 KB, returns `{ id, url }`
- `haszno_shop_suggest_from_photos` — AI pre-fill ad fields from uploaded image IDs (`imageIds: number[]`, 1–3)
- `haszno_shop_create_ad` — post a new ad (validates required category attrs before sending) *(confirm: true)*
- `haszno_shop_update_ad` — edit an existing ad (fetches current state then PUTs merged body)
- `haszno_shop_set_ad_status` — `aktiv` (show/reactivate), `szunetel` (pause), or `torolve` (permanently delete)
- `haszno_shop_mark_sold` — mark an ad sold (irreversible) *(confirm: true)*
- `haszno_shop_renew_ad` — reset 60-day expiry and bump ad to top of search
- `haszno_shop_send_inquiry` — send a question to the seller (`adId`, `name`, `email`, `message`)
- `haszno_shop_set_favorite` — save (`save: true`) or remove (`save: false`) a favorite
- `haszno_shop_reserve_ad` — place a reservation on an ad (not a payment; `message?`, `offerPriceGross?`, `phone?`) *(confirm: true)*
- `haszno_shop_respond_reservation` — `accept` or `decline` a reservation (seller)
- `haszno_shop_cancel_reservation` — cancel your own reservation, sets status `visszavonva` (buyer)
- `haszno_shop_complete_reservation` — mark a reservation fulfilled → ad becomes `eladva` (seller, irreversible) *(confirm: true)*
- `haszno_shop_counter_offer` — seller proposes a counter-price on a pending reservation (`id`, `priceGross`); sets `counterPriceGross` on the reservation
- `haszno_shop_accept_counter` — buyer accepts the seller's counter-offer (`id`); `offerPriceGross` is updated to the agreed price
- `haszno_shop_send_message` — send a message in a reservation thread (`id`, `body`); returns `{ message: { id, author, body, createdAt } }`
- `haszno_shop_review` — buyer leaves a star rating + optional comment after a completed reservation (`id`, `rating` 1–5, `comment?`) *(confirm: true)*
- `haszno_shop_reply_inquiry` — seller replies to a buyer's inquiry (`id` = inquiry ID, `message`); returns `{ reply: { id, inquiryId, message, createdAt } }`
- `haszno_shop_save_search` — save a search with optional price-alert (`name`, `filters`, `alertEnabled?`)
- `haszno_shop_delete_saved_search` — delete a saved search by `id`
- `haszno_shop_watch_price` — subscribe (`watch: true`) or unsubscribe (`watch: false`) to price-change alerts on an ad (`adId`)
- `haszno_shop_import_from_url` — AI-extract ad fields (title, description, price, images) from a product page URL; returns `{ title?, description?, price?, images[], parsed }`
- `haszno_shop_save_draft` — save or overwrite your in-progress ad draft (`payload`: partial ad fields); returns the saved draft with `updatedAt`
- `haszno_shop_clear_draft` — permanently delete your ad draft
- `haszno_shop_remove_background` — remove the background from an already-uploaded image (`imageId`); returns a new image object `{ id, url }`

**Partner network & syndication (requires `sellerType = 'kereskedo'`)**
- `haszno_shop_partner_profile_get` — get or auto-create your partner profile (displayName, description, sellerType, contactEmail, contactPhone, website); first call creates it
- `haszno_shop_partner_profile_update` — update displayName (2–60 chars), description (up to 2000 chars), contactEmail, contactPhone, website
- `haszno_shop_partner_syndications_list` — list your active ad syndications (markup is returned without the private multiplier)
- `haszno_shop_partner_syndication_upsert` — create or update a syndicated ad listing (`adId`, `markupPct` 0–100, `markupFt` 0–50 000 000); requires `sellerType = 'kereskedo'` → 403 `seller_type_required` otherwise
- `haszno_shop_partner_syndication_remove` — stop syndicating an ad (`adId`); requires `confirm: true`

**Moderation**
- `haszno_shop_moderation_list` — list your ads currently under moderation review
- `haszno_shop_moderation_appeal` — submit an appeal for a moderation decision (`id`, `message` 10–2000 chars); requires `confirm: true`

**Reservation statuses:** `fuggoben` (pending), `elfogadva` (accepted), `elutasitva` (declined/auto-declined), `visszavonva` (cancelled by buyer), `teljesitve` (completed), `lejart` (hold expired)

**Price negotiation flow:** buyer places reservation (`offerPriceGross?`) → seller counters (`haszno_shop_counter_offer`) → buyer accepts (`haszno_shop_accept_counter`) → `agreedPriceGross` is set → seller completes → buyer reviews

### MCP Resources

The server exposes one MCP resource that agents can read before calling any tool:

| URI | Description |
|---|---|
| `haszno://capabilities` | Active credential mode (`shopToken` / `legacyKey` / `basic`), which tool groups are available, what limitations apply, and the full error code map. Read this first if you are unsure which tools to call. |

---

## Library entry (`@haszno/mcp/lib`)

The package ships a side-effect-free library entry for **hosted (HTTP/remote) MCP endpoints**.
Importing it starts no server, reads no env vars, and touches no files.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerShopTools, type HttpOptions } from '@haszno/mcp/lib'

const server = new McpServer({ name: 'my-server', version: '1.0.0' })

registerShopTools(
  server,
  {
    apiKey:  req.headers['x-haszno-token'], // per-request credential
    baseUrl: process.env.HASZNO_API_BASE,
    fetch,                                  // supply the runtime's fetch
  },
  { remote: true },  // ← enables remote mode
)
```

`remote: true` guarantees:

- **`haszno_shop_upload_image`** — `filePath` is absent from the tool schema; the handler
  only accepts `base64 + mimeType` and never calls `fs.readFileSync`.
- **No env-var fallbacks** — `HASZNO_API_TOKEN`, `HASZNO_API_KEY`, `HASZNO_API_URL`, etc.
  are ignored. All credentials and the base URL must come from the `opts` argument.

Peer dependencies (must be installed by the host application):

| Package | Version |
|---|---|
| `@modelcontextprotocol/sdk` | `^1.12.0` |
| `zod` | `^4.0` |

---

## Development

```bash
npm install
npm run build      # tsup build (emits dist/index.js + dist/lib.js)
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

---

## Documentation

Full developer docs: [https://docs.haszno.com/en/](https://docs.haszno.com/en/)

---

## License

MIT — Copyright (c) 2026 Haszno Labs
