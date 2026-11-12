# @haszno/mcp

[English](README.md) | **Magyar**

**Haszno MCP szerver** — Claude-hoz és más MCP-kompatibilis AI ügynökhöz.

A szerver stdio transzporton fut, és hozzáférést ad a Haszno árazási platformhoz: termékek, árajánlatok, automatikák, megrendelések, partnerkatakógus és termékötletek.

---

## Kapcsolódó repók

| Repó | Leírás |
|---|---|
| [`haszno-labs/haszno-cli`](https://github.com/haszno-labs/haszno-cli) | Parancssori kliens (`haszno login`, `haszno products list`, ...) |
| [`haszno-labs/haszno-mcp`](https://github.com/haszno-labs/haszno-mcp) | Ez a repó — MCP szerver Claude Code-hoz |
| [`haszno-labs/haszno-skill`](https://github.com/haszno-labs/haszno-skill) | Claude Code skill — kontextus és workflow minták |

Egyszerre telepíti mindhármat az **install script**:

```bash
curl -fsSL https://raw.githubusercontent.com/haszno-labs/haszno-skill/main/install.sh | bash
```

---

## Telepítés

### npx (nyilvánossá tétel után — nem kell klónolni)

```bash
claude mcp add haszno -- npx -y github:haszno-labs/haszno-mcp
```

### Helyi telepítés (jelenleg)

```bash
# 1. Klónozás
git clone https://github.com/haszno-labs/haszno-mcp ~/.haszno/haszno-mcp
cd ~/.haszno/haszno-mcp

# 2. Build
npm install
npm run build

# 3. Claude Code-ba regisztrálás
claude mcp add haszno -- node ~/.haszno/haszno-mcp/dist/index.js
```

---

## Hitelesítés

A szerver az alábbi sorrendben olvassa a hitelesítési adatokat:

1. `HASZNO_API_TOKEN` — bolt API-token (**elsődleges**; létrehozás: Haszno → Integráció → API-kulcsok)
2. `HASZNO_API_KEY` — `HASZNO_API_TOKEN` örökös aliasza (csendes migráció; mindkettő `Authorization: Bearer`-ként küldődik)
3. `ARFUTAR_API_KEY` — régi alias (csendes visszafelé-kompatibilitás)
4. `HASZNO_BASIC` — HTTP Basic auth (csak session-alapú végpontokhoz)
5. `~/.config/haszno/config.json` — a CLI `haszno configure` parancsa írja
6. `~/.config/arfutar/config.json` (csendes visszafelé-kompatibilitás)

### API-kulcs létrehozása

1. Lépj be a [haszno.com](https://haszno.com) → **Integráció → API-kulcsok** oldalra
2. Kattints az **Új API-kulcs** gombra, adj nevet, válaszd az **agent** hatáskört
3. Másold ki a `haszno_…` tokent — csak egyszer látható
4. Állítsd be: `HASZNO_API_TOKEN=haszno_…`

> **Hatáskörök:** a bolt token **olvasási** jogot ad a termékekhez, rendelésekhez és függő javaslatokhoz,
> valamint **írási** jogot új javaslatok létrehozásához (csak pending státuszba).
> A jóváhagyás / elutasítás / visszagörgetés emberi döntést igényel a webes felületen —
> ez szándékos: az árváltozásokhoz kötelező az ember-a-hurokba elv.

> **Lejárat:** a token az API-kulcsok oldalon megjelölt idő után lejár. Lejáratkor hozz létre újat.

A konfigurációs fájl formátuma (lapos, nem profil-keyed):

```json
{
  "apiUrl": "https://haszno.com",
  "apiKey": "haszno_xxxx"
}
```

Ugyanezt az MCP szerveren keresztül is be lehet állítani:

```
haszno_account_configure(apiUrl: "https://haszno.com", apiKey: "haszno_xxxx", confirm: true)
```

---

## Környezeti változók

| Változó | Leírás |
|---|---|
| `HASZNO_API_URL` | A Haszno-példány alap URL-je (alapértelmezett: `https://haszno.com`) |
| `HASZNO_API_TOKEN` | Bolt Bearer token (**elsődleges**) — `Authorization: Bearer`-ként küldődik |
| `HASZNO_API_KEY` | `HASZNO_API_TOKEN` örökös aliasza — azonos módon kezelt |

---

## Eszközök (tool-ok)

### Fiók (`haszno_account_*`)
- `haszno_ping` — kapcsolat ellenőrzése
- `haszno_account_get_settings` — árszabályok lekérése
- `haszno_account_update_settings` — árszabályok frissítése
- `haszno_account_get_stats` — bolt összefoglalója
- `haszno_account_get_impact` — haszon-mérő (N nap)
- `haszno_account_list_suppliers` — saját beszállítók listája
- `haszno_account_configure` — API hitelesítés mentése

### Partnerkatakógus (`haszno_catalog_*`)
- `haszno_catalog_list_categories` — kategóriák
- `haszno_catalog_list_suppliers` — partner beszállítók böngészése
- `haszno_catalog_supplier_products` — egy partner termékeit listázza
- `haszno_catalog_supplier_view` — piaci statisztikák egy partnernél
- `haszno_catalog_connect_supplier` — partner csatlakoztatása
- `haszno_catalog_sync_supplier` — partner szinkronizálása

### Termékek (`haszno_products_*`)
- `haszno_products_list` — bolt termékei marginnal és ajánlott árakkal (agent endpoint)
- `haszno_products_update` — *(nem elérhető bolt tokennel)*
- `haszno_products_set_listing` — *(nem elérhető bolt tokennel)*
- `haszno_products_apply_prices` — *(nem elérhető bolt tokennel)*
- `haszno_products_ai_description` — *(nem elérhető bolt tokennel)*

### Árajánlatok (`haszno_proposals_*`)
- `haszno_proposals_list` — függő javaslatok listája (agent endpoint; csak pending)
- `haszno_proposals_market` — javaslat + termék kontextus (agent endpoint)
- `haszno_proposals_create` — új pending javaslat létrehozása automatikus nonce-szal (agent endpoint)
- `haszno_proposals_approve` — *(nem elérhető bolt tokennel — emberi jóváhagyás szükséges)*
- `haszno_proposals_reject` — *(nem elérhető bolt tokennel — emberi jóváhagyás szükséges)*
- `haszno_proposals_rollback` — *(nem elérhető bolt tokennel — emberi jóváhagyás szükséges)*

### Automatikák / Szabályok (`haszno_rules_*`, `haszno_automation_*`)
- `haszno_rules_list_templates` — sablonok
- `haszno_rules_list` / `haszno_rules_create` / `haszno_rules_update` / `haszno_rules_delete`
- `haszno_rules_run` / `haszno_rules_run_all` / `haszno_rules_trigger`
- `haszno_rules_list_runs` / `haszno_rules_undo_unlists`
- `haszno_automation_get` / `haszno_automation_set`

### Megrendelések (`haszno_orders_*`)
- `haszno_orders_list` — utolsó 20 rendelés (agent endpoint; id, vevő, állapot, összeg, tételek)
- `haszno_orders_get` — egy rendelés tételekkel (agent endpoint)
- `haszno_orders_ship` — *(nem elérhető bolt tokennel)*
- `haszno_orders_receive` — *(nem elérhető bolt tokennel)*
- `haszno_orders_create_demo` — *(nem elérhető bolt tokennel)*

### Feedek (`haszno_feeds_*`)
- `haszno_feeds_import_supplier` — beszállítói feed importálása
- `haszno_feeds_import_market` — piaci árak importálása
- `haszno_feeds_outbound_info` — kiadott feed URL-ek

### Termékötletek (`haszno_ideas_*`)
- `haszno_ideas_list` — trend-pontozású termékötletek
- `haszno_ideas_ai_shortlist` — AI által kiválasztott shortlist
- `haszno_ideas_ai_description` — AI termékleírás generátor
- `haszno_ideas_fill_keywords` — hiányzó trendkulcsszavak pótlása

---

## Fejlesztés

```bash
npm install
npm run build      # tsup build
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

---

## Dokumentáció

Fejlesztői dokumentáció: [https://docs.haszno.com](https://docs.haszno.com)

---

## Licenc

MIT — Copyright (c) 2026 Haszno Labs
