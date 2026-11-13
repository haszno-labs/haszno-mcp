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

## Hitelesítés — kétféle mód

A szerver automatikusan választja ki a módot a megadott credential alapján.

### 1. mód — Bolt-token (ügynök-hozzáférés, `haszno_` előtag)

A bolt-tokenek `haszno_` előtaggal kezdődnek, és az **ügynök-végpontokhoz** adnak
hozzáférést: termékek olvasása, megrendelések olvasása, javaslatok olvasása és
**beküldése**. Minden más művelet (beállítások, automatikák, feedek, katalógus, …)
azonnal hibát ad, HTTP-hívás nélkül.

Bolt-tokent a Haszno webalkalmazásban lehet igényelni: **API-kulcsok**:
- Hatókörök: `read` (GET) és/vagy `write` (javaslat beküldése)
- Lejárat: 90 nap; a megújítás emberi jóváhagyást igényel
- Emberi jóváhagyás kötelező: a bolt tulajdonosának el kell fogadnia minden token-kérelmet

A tokent az **ajánlott** környezeti változóval adja meg:

```bash
export HASZNO_API_TOKEN=haszno_xxxxxxxxxxxxxxxxxxxx
```

### 2. mód — Hagyományos API-kulcs (teljes hozzáférés)

Minden `haszno_` előtag nélküli credential (sima API-kulcs, HTTP Basic) `x-api-key`
vagy `Authorization: Basic` fejlécként kerül továbbításra, pontosan a korábbi módnak
megfelelően. Minden tool és művelet elérhető.

### Credential feloldási sorrend

1. `HASZNO_API_TOKEN` — bolt-tokenek preferált helye
2. `HASZNO_API_KEY` / `ARFUTAR_API_KEY` — szintén elfogadott (bolt-token vagy hagyományos)
3. `~/.config/haszno/config.json` — a CLI `haszno configure` parancsa írja
4. `~/.config/arfutar/config.json` (csendes visszafelé-kompatibilitás)

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
| `HASZNO_API_TOKEN` | Bolt-token (ajánlott; `haszno_` előtagú tokenekhez) |
| `HASZNO_API_KEY` | API kulcs — bolt-token vagy hagyományos kulcs |

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
- *(hamarosan)*

### Árajánlatok (`haszno_proposals_*`)
- `haszno_proposals_list` — javaslatok listája / lapozás
- `haszno_proposals_market` — javaslat + piaci kontextus
- `haszno_proposals_approve` — javaslatok jóváhagyása *(csak hagyományos kulccsal)*
- `haszno_proposals_reject` — javaslatok elutasítása *(csak hagyományos kulccsal)*
- `haszno_proposals_rollback` — köteg visszavonása *(csak hagyományos kulccsal)*
- `haszno_proposals_propose` — új árjavaslat beküldése *(bolt-token + write hatókör)*

### Automatikák / Szabályok (`haszno_rules_*`, `haszno_automation_*`)
- `haszno_rules_list_templates` — sablonok
- `haszno_rules_list` / `haszno_rules_create` / `haszno_rules_update` / `haszno_rules_delete`
- `haszno_rules_run` / `haszno_rules_run_all` / `haszno_rules_trigger`
- `haszno_rules_list_runs` / `haszno_rules_undo_unlists`
- `haszno_automation_get` / `haszno_automation_set`

### Megrendelések (`haszno_orders_*`)
- `haszno_orders_list` / `haszno_orders_get`
- `haszno_orders_ship` / `haszno_orders_receive`
- `haszno_orders_create_demo` *(csak demo környezetben)*

### Feedek (`haszno_feeds_*`)
- `haszno_feeds_import_supplier` — beszállítói feed importálása
- `haszno_feeds_import_market` — piaci árak importálása
- `haszno_feeds_outbound_info` — kiadott feed URL-ek

### Termékötletek (`haszno_ideas_*`)
- `haszno_ideas_list` — trend-pontozású termékötletek
- `haszno_ideas_ai_shortlist` — AI által kiválasztott shortlist
- `haszno_ideas_ai_description` — AI termékleírás generátor
- `haszno_ideas_fill_keywords` — hiányzó trendkulcsszavak pótlása

### Hirdetési Piactér (`haszno_shop_*`)

A Haszno Shop (Hirdetési Piactér) **teljesen ingyenes** — sem feladásért, sem használatért nem kell fizetni.
A foglalás nem fizetés: a vételár és az átadás közvetlenül a vevő és az eladó között zajlik.

**Olvasó eszközök (mellékhatás nélkül)**
- `haszno_shop_list_categories` — kategóriataxonómia (`key`, `attrs` kategóriánként, `conditions`, `counties`)
- `haszno_shop_search_ads` — nyilvános hirdetések keresése (`q`, `cat`, `sub`, `min`, `max`, `county`, `city`, `cond`, `sort`, `page`); rendezés: `uj` (legújabb), `ar_nov` (ár növekvő), `ar_csokk` (ár csökkenő)
- `haszno_shop_get_ad` — egyetlen hirdetés részletei a `reserved` jelzővel
- `haszno_shop_price_hint` — javasolt árkeret (p25–p75) `cat` (kategória kulcs) és opcionális `sub` alkategória alapján
- `haszno_shop_list_my_ads` — saját, nem törölt hirdetések
- `haszno_shop_list_inquiries` — vevők által küldött kérdések (`adId?`, `limit`, `offset`)
- `haszno_shop_list_favorites` — mentett kedvenc hirdetések
- `haszno_shop_list_reservations` — foglalásaim `buyer` (alapértelmezett) vagy `seller` nézőpontból

**Író eszközök (hitelesítés szükséges; a create/reserve/complete megköveteli a `confirm: true` mezőt)**
- `haszno_shop_upload_image` — kép feltöltése (`filePath` vagy `base64` + `mimeType`), max 700 KB, visszaad `{ id, url }`
- `haszno_shop_suggest_from_photos` — AI előtöltés feltöltött kép-azonosítókból (`imageIds: number[]`, 1–3 db)
- `haszno_shop_create_ad` — új hirdetés feladása (kötelező kategóriaattribútumokat ellenőrzi) *(confirm: true)*
- `haszno_shop_update_ad` — meglévő hirdetés szerkesztése (lekéri a jelenlegi adatokat, majd PUT-tal frissíti)
- `haszno_shop_set_ad_status` — `aktiv` (megjelenítés/újraaktiválás), `szunetel` (szüneteltetés), `torolve` (végleges törlés)
- `haszno_shop_mark_sold` — hirdetés eladottnak jelölése (visszafordíthatatlan) *(confirm: true)*
- `haszno_shop_renew_ad` — 60 napos lejárat visszaállítása, hirdetés a keresési lista tetejére kerül
- `haszno_shop_send_inquiry` — kérdés küldése az eladónak (`adId`, `name`, `email`, `message`)
- `haszno_shop_set_favorite` — kedvenc mentése (`save: true`) vagy törlése (`save: false`)
- `haszno_shop_reserve_ad` — foglalás leadása (`message?`, `offerPriceGross?`, `phone?`; nem fizetés) *(confirm: true)*
- `haszno_shop_respond_reservation` — foglalás `accept` (elfogadás) vagy `decline` (elutasítás) (eladó)
- `haszno_shop_cancel_reservation` — saját foglalás lemondása, státusz `visszavonva` (vevő)
- `haszno_shop_complete_reservation` — foglalás teljesítettnek jelölése → hirdetés `eladva` lesz (eladó, visszafordíthatatlan) *(confirm: true)*

**Foglalás-státuszok:** `fuggoben` (függőben), `elfogadva` (elfogadva), `elutasitva` (elutasítva/automatikusan elutasítva), `visszavonva` (vevő mondta le), `teljesitve` (teljesítve), `lejart` (foglalás lejárt)

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
