# Retailer Map — Handoff Doc
_Updated 2026-05-12_

---

## Current State

### What was fixed today (commit 3f8b760)
- **Logo cutoff in cluster cells** — root cause: Leaflet CSS `.leaflet-marker-pane img { width: auto; max-width: none }` overrides explicit `width="44"` attributes. Wide logos (Pep Boys 2.16:1) computed to 95px wide inside 52px `overflow:hidden` cells → clipped. Fixed with `width/height/max-width/max-height: 44px !important` on `.sc-cell img`.
- **Chain deduplication** — one marker per brand per map, keeps closest location to property. Count badge (gold pill, top-right) shows how many total locations exist (e.g. "3" for 3 Starbucks).
- **16:9 export** — capture 1280×720, output PNG 3840×2160, PDF 13.33×7.5in (PowerPoint widescreen).
- **Vitamin Shoppe** — added to `RETAILER_DOMAINS` so BrandFetch proxy is tried.
- **Server proxy** — now tries `logo.png` wordmark as last-resort fallback for brands with no square icon.
- **`capture-map.mjs`** — Puppeteer CLI added. Opens retailer-map.vercel.app, enters address, waits for load, clicks Export PNG, saves to output path.

---

## Open Items

### 1. Stella integration — wire `capture-map.mjs` into OM pipeline

**Goal:** `npm run generate-om -- "Deal-Name"` should auto-generate the retailer map PNG (no manual step).

**How generate-om.js already works:**
- Accepts optional `retailerMapPath` as 3rd CLI arg: `node src/om/generate-om.js "Deal" ./map.png`
- Auto-detects `retailer_map` or `retailermap` filename in the deal's media folder
- Pre-crops to 10"×5.175" (full-bleed slide slot) via `cropToBox`

**What needs to happen:**
- Before the `loadImages()` call in `generate-om.js`, check if a retailer map already exists in the media dir
- If NOT, spawn `capture-map.mjs` as a subprocess to generate one:
  ```
  node C:\Users\Jetsk\Code\retailer-map\capture-map.mjs "<address>" "<mediaDir>/retailer_map.png"
  ```
- `address` comes from `dealInfo.address` (already parsed from DEAL-INFO.md)
- Save as `retailer_map.png` in the deal's media folder so it also persists for next run

**Known issues with `capture-map.mjs`:**
- Uses `puppeteer-core` — Chrome must be at `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `headless: false` currently — works fine for manual use, change to `headless: 'new'` for automated pipeline
- Export button selector uses text match (`t.includes('export') && t.includes('image')`) — verify this matches current button text
- URL is `https://retailer-map.vercel.app` (production) — fast, no local server needed

**Files to edit:**
- `C:\Users\Jetsk\Code\Stella\src\om\generate-om.js` — add subprocess call before `loadImages()`
- `C:\Users\Jetsk\Code\retailer-map\capture-map.mjs` — change `headless: false` → `headless: 'new'` for pipeline use

---

### 2. Retailer Map — remaining UI/logo work

**Advance Auto Parts logo** (`client/public/logos/Advance Auto Parts.png`, 1442 bytes):
- Currently shows only the checkered flag icon (no wordmark text)
- If a better PNG is sourced (full "Advance Auto Parts" wordmark), drop it in `client/public/logos/` at the same filename — no code change needed
- Or: remove from `LOGO_FILES` in `logos.js` so BrandFetch wordmark fallback is tried (proxy now tries `logo.png` last)

**Blank staging files** (not committed, in repo root `Retailer Logos/`):
- `Retailer Logos/Advance Auto Parts.png`, `OReilly Auto Parts.png`, `Vitamin Shoppe.png` — these are blank files from a failed download attempt
- Either delete them or add `Retailer Logos/` to `.gitignore`

**O'Reilly Auto Parts** — logo looks correct (124KB wordmark). No action needed.

**Pep Boys** — logo looks correct after today's fix. No action needed.

**Vitamin Shoppe** — no PNG file. Domain mapping added → BrandFetch will be tried at runtime. If BrandFetch returns nothing, a category pin shows. Acceptable until a PNG is sourced.

---

## Key File Locations

| File | Purpose |
|------|---------|
| `capture-map.mjs` | Puppeteer CLI: address → PNG |
| `client/src/App.jsx` | Dedup logic, export dimensions |
| `client/src/clustering.js` | Layout, collision avoidance |
| `client/src/logos.js` | Domain/file mappings, icon creation |
| `client/src/index.css` | `.sc-cell img !important` fix lives here |
| `server/index.js` | BrandFetch proxy with logo.png fallback |
| `C:\Users\Jetsk\Code\Stella\src\om\generate-om.js` | Where subprocess call belongs |
| `C:\Users\Jetsk\Code\Stella\src\om\slides\retailer-map-slide.js` | Renders `images.retailerMapCropped` |

---

## How to Test

```bash
# Test capture-map standalone
cd C:\Users\Jetsk\Code\retailer-map
node capture-map.mjs "5000 McKnight Rd, Pittsburgh, PA 15237" "C:\temp\test-map.png"

# Once Stella integration is wired:
cd C:\Users\Jetsk\Code\Stella
npm run generate-om -- "Deal-Name"
```
