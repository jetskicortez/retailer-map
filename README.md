# Retailer Map Generator — The Colony Agency

A commercial real estate tool that generates interactive trade area retailer maps. Enter a property address, search radius, and property type to visualize nearby national and regional retailers on a dark-themed Leaflet.js map with brand logos, smart clustering, and PDF/PNG export.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Data Pipeline](#data-pipeline)
- [File Structure](#file-structure)
- [Data Storage](#data-storage)
- [Map Rendering & Clustering](#map-rendering--clustering)
- [Logo System](#logo-system)
- [Export Pipeline](#export-pipeline)
- [Setup](#setup)
- [Usage](#usage)
- [Tech Stack](#tech-stack)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser (React)                       │
│  App.jsx — form, sidebar, Leaflet map, SmartClusterLayer     │
└────────────┬──────────────────────────────────┬──────────────┘
             │ POST /api/places-nearby          │ POST /api/geocode
             ▼                                  ▼
┌──────────────────────────────────────────────────────────────┐
│                Express Proxy Server (:3001)                   │
│  server/index.js                                             │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐ │
│  │ Google Places    │  │ Google Geocoding │  │ Anthropic   │ │
│  │ Nearby + Text    │  │ API             │  │ API Proxy   │ │
│  │ Search           │  │                 │  │ /api/claude  │ │
│  └────────┬────────┘  └────────┬─────────┘  └──────┬──────┘ │
└───────────┼─────────────────────┼──────────────────┼─────────┘
            ▼                     ▼                  ▼
   Google Places API      Google Maps API     Anthropic API
   (New v1 endpoint)      (Geocoding)         (Claude)
```

---

## Data Pipeline

### Step 1: User Input
The user provides a **property address**, **search radius** (1–5 miles), and **property type** via the sidebar form.

### Step 2: Geocoding
The backend geocodes the property address using the **Google Maps Geocoding API** (`/api/geocode`), returning lat/lng coordinates.

### Step 3: Retailer Discovery (Google Places API)
The core data fetch happens via `POST /api/places-nearby`:

1. **Multi-point search**: For radii > 2 miles, the server generates 5 search points (center + 4 cardinal offsets at 60% radius) to overcome Google's 20-result-per-query limit.

2. **Type-batched queries**: Each search point runs 10 parallel batches of place types:
   - `restaurant`, `fast_food_restaurant`
   - `cafe`, `coffee_shop`
   - `supermarket`, `grocery_store`, `convenience_store`
   - `department_store`, `clothing_store`, `electronics_store`, `discount_store`
   - `shopping_mall`, `shoe_store`, `book_store`, `jewelry_store`
   - `pharmacy`, `drugstore`, `gym`
   - `bank`, `gas_station`, `car_repair`, `car_wash`
   - `home_improvement_store`, `pet_store`, `furniture_store`
   - `auto_parts_store`, `liquor_store`
   - `movie_theater`, `bowling_alley`

3. **Supplementary text searches**: Three additional text queries (`national retail stores`, `fast food chains`, `auto parts stores`) to catch chains missed by type search.

4. **Deduplication**: Results are deduplicated by Google Place ID.

5. **Filtering**: National brands (matched against a 170+ entry `NATIONAL_BRANDS` set) always pass. Other retailers need a minimum of 30 user ratings (lowered to 10 or 0 if too few results).

6. **Category mapping**: Each place is assigned a category (Grocery, Pharmacy, Fast Food, etc.) based on its Google `primaryType` using the `GOOGLE_TYPE_TO_CATEGORY` lookup.

7. **Chain classification**: Each retailer is classified as `National` or `Regional/Local` using `classifyChainSize()`, which checks exact and prefix matches against the `NATIONAL_BRANDS` set.

8. **Sub-department deduplication**: Parent brands (Walmart, CVS, Giant Eagle, etc.) are collapsed — e.g., "Walmart Pharmacy" and "Walmart Auto Care Center" merge into the main "Walmart Supercenter" entry (highest review count wins).

9. **Radius filtering**: Only retailers within the requested radius (haversine distance) are included.

10. **Response shape**:
```json
{
  "property": { "lat": 40.32, "lng": -79.38, "display": "533 Depot St, Latrobe, PA" },
  "retailers": [
    {
      "name": "Walmart Supercenter",
      "category": "Grocery",
      "address": "100 Colony Ln, Latrobe, PA 15650",
      "lat": 40.289,
      "lng": -79.404,
      "distance_miles": 1.87,
      "rating": 4.1,
      "userRatingCount": 5230,
      "placeId": "ChIJ...",
      "chainSize": "National"
    }
  ]
}
```

---

## File Structure

```
Retailer_map/
├── .env                          # API keys (ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY)
├── .env.example                  # Template for required env vars
├── .gitignore
├── package.json                  # Root: Express server + concurrently runner
├── start-client.js               # Vite dev server launcher
│
├── server/
│   └── index.js                  # Express backend (port 3001)
│                                 #   - POST /api/claude (Anthropic proxy)
│                                 #   - POST /api/geocode (single address)
│                                 #   - POST /api/geocode-batch (batch)
│                                 #   - POST /api/places-nearby (retailer discovery)
│
├── client/
│   ├── index.html                # Vite entry point
│   ├── package.json              # Frontend dependencies
│   ├── vite.config.js
│   ├── public/
│   │   └── logos/                # 211 brand logo files (PNG/SVG/WebP)
│   │       ├── Walmart.png
│   │       ├── Target.png
│   │       ├── Starbucks.png
│   │       └── ... (211 files)
│   └── src/
│       ├── main.jsx              # React entry
│       ├── App.jsx               # Main component (~1363 lines)
│       │   ├── CATEGORIES         # 16 category configs (color + emoji)
│       │   ├── LOGO_FILES         # 180+ retailer name → logo filename mappings
│       │   ├── SmartClusterLayer  # Clustering + collision-avoidance renderer
│       │   ├── Export functions    # PNG (html2canvas) and PDF (jsPDF) export
│       │   └── Sidebar + Map UI   # Form, retailer cards, Leaflet map
│       └── index.css             # All styles (dark theme, markers, clusters)
│
└── Retailer Logos/               # Source/reference logo files (high-res originals)
```

---

## Data Storage

This application is **stateless** — there is no database. All data flows through the pipeline in real-time:

| Data | Where It Lives | Persistence |
|------|---------------|-------------|
| API keys | `.env` file (server root) | On disk, git-ignored |
| Retailer data | React state (`data` in App.jsx) | In-memory only, lost on refresh |
| Brand logos | `client/public/logos/` | Static files on disk (211 files) |
| Logo name mappings | `LOGO_FILES` object in App.jsx | Hardcoded in source |
| National brands list | `NATIONAL_BRANDS` set in server/index.js | Hardcoded in source |
| Category configs | `CATEGORIES` object in App.jsx | Hardcoded in source |
| User inputs | React state (address, radius, type) | In-memory only |
| Export outputs | User's downloads folder | PNG/PDF files via browser download |

**No data is cached or persisted between sessions.** Each "Generate Map" click makes fresh API calls to Google Places.

---

## Map Rendering & Clustering

### Marker Types
- **Subject Property**: Gold pin with star icon, "SUBJECT PROPERTY" label, animated pulse ring
- **Logo markers**: Retailers with matching logo files get a dark rounded card with the brand logo (44px or 80px wide for landscape logos)
- **Category markers**: Retailers without logos get a colored pin with category emoji

### Smart Clustering System (`SmartClusterLayer`)

The map uses a custom hybrid clustering + collision-avoidance system (not Leaflet.markercluster):

1. **Union-Find Clustering** (`buildClusters`):
   - Converts all marker positions to pixel space
   - Merges markers within a zoom-adaptive distance using union-find
   - Zoom distances: 25px (zoom ≥16) → 35px (≥14) → 48px (≥12) → 60px (zoomed out)
   - Oversized clusters (>6 items) are split into smaller chunks

2. **Cluster Grid Icons** (`createClusterGridIcon`):
   - Renders a dark card with a grid of mini logos (32×32px cells, max 3 columns)
   - Retailers with logos show the actual brand logo
   - Retailers without logos show colored initials with category-based background
   - Gold badge shows item count

3. **Collision Avoidance** (`displaceClusterRects`):
   - Runs 35 iterations of bounding-box push resolution
   - Subject property gets full-strength push (1.0) — it's never blocked
   - Cluster-to-cluster collisions resolved at 0.6 strength
   - Displaced markers get a connecting polyline back to their original position

4. **Debounced recalculation**: Clusters recalculate on `zoomend`/`moveend` with 120ms debounce

---

## Logo System

### How Logos Are Resolved

1. **`getLogoUrl(retailerName)`** normalizes the name to lowercase and checks:
   - Exact match against `LOGO_FILES` (180+ entries with variant spellings)
   - Prefix match (e.g., "Walmart Supercenter" matches "walmart")

2. **Logo files** are stored in `client/public/logos/` (served as static assets by Vite)

3. **Wide logos** (aspect ratio > 2.2:1) are rendered in an 80px container; standard logos use 44px. The `WIDE_LOGOS` set contains ~45 entries.

### Adding a New Logo

1. Save the logo file (PNG preferred, 128×128px minimum) to `client/public/logos/`
2. Add entries to the `LOGO_FILES` object in `App.jsx` with all common name variants:
   ```javascript
   "brand name": 'BrandName.png',
   "brand name variant": 'BrandName.png',
   ```
3. If the logo is wider than 2.2:1 aspect ratio, add the filename to the `WIDE_LOGOS` set

---

## Export Pipeline

### PNG Export (`handleExportImage`)
1. Hides map controls (zoom, attribution)
2. Fixes `object-fit` images for html2canvas compatibility
3. Renders the map panel at 3× scale via `html2canvas`
4. Downloads as `retailer-map.png`

### PDF Export (`handleExportPDF`)
1. Same html2canvas capture at 3× scale
2. Calculates landscape layout to fit the image
3. Generates PDF via `jsPDF` with the map image embedded
4. Downloads as `retailer-map.pdf`

### CSV Export (`handleExportCSV`)
Exports the retailer table as a CSV file with columns: Name, Category, Address, Distance, Rating, Reviews, Chain Size.

---

## Setup

### Prerequisites
- Node.js 18+
- A Google Maps API key with Places API (New) and Geocoding API enabled
- An Anthropic API key (for the Claude proxy endpoint)

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure API keys

Copy `.env.example` to `.env` and add your keys:

```
ANTHROPIC_API_KEY=sk-ant-...your-key-here
GOOGLE_MAPS_API_KEY=AIza...your-key-here
```

### 3. Start the app

```bash
npm run dev
```

This starts both the Express server (port 3001) and the Vite dev server concurrently.

**Open the app at** [http://localhost:5173](http://localhost:5173)

---

## Usage

1. Enter a property address (e.g., `533 Depot St, Latrobe, PA`)
2. Select a search radius (1–5 miles)
3. Choose the property type
4. Click **Generate Map**
5. Browse retailers in the sidebar or click markers/clusters on the map
6. Use the category filter pills to show/hide specific retailer types
7. Click **Export PNG**, **Export PDF**, or **Export CSV** to download

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, Leaflet.js 1.9, react-leaflet 4.2 |
| Backend | Express 4, Node.js (ES modules) |
| APIs | Google Places API (New), Google Geocoding API, Anthropic Claude API |
| Export | html2canvas, jsPDF |
| Styling | Custom CSS (dark theme with gold accents, CSS variables) |
| Clustering | Custom union-find algorithm with collision avoidance |
