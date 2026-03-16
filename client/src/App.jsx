import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// markercluster removed — using custom displacement layer instead
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// ── Category config ──────────────────────────────────────────────
const CATEGORIES = {
  Grocery:          { color: '#4CAF50', emoji: '\u{1F6D2}' },
  Pharmacy:         { color: '#f44336', emoji: '\u{1F48A}' },
  'Fast Food':      { color: '#FF9800', emoji: '\u{1F354}' },
  'Casual Dining':  { color: '#FFD600', emoji: '\u{1F37D}' },
  Coffee:           { color: '#795548', emoji: '\u2615' },
  Fitness:          { color: '#9C27B0', emoji: '\u{1F4AA}' },
  'Home Improvement': { color: '#8D6E63', emoji: '\u{1F528}' },
  Banking:          { color: '#2196F3', emoji: '\u{1F3E6}' },
  Auto:             { color: '#607D8B', emoji: '\u{1F697}' },
  Entertainment:    { color: '#E91E63', emoji: '\u{1F3AC}' },
  'Department Store': { color: '#00BCD4', emoji: '\u{1F6CD}' },
  'Discount/Value': { color: '#FF5722', emoji: '\u{1F3F7}' },
  Pet:              { color: '#4DB6AC', emoji: '\u{1F43E}' },
  'Cellular/Tech':  { color: '#5C6BC0', emoji: '\u{1F4F1}' },
  Convenience:      { color: '#FFA726', emoji: '\u26FD' },
  Other:            { color: '#78909C', emoji: '\u{1F4CD}' },
};

function getCategoryConfig(category) {
  if (CATEGORIES[category]) return CATEGORIES[category];
  for (const key of Object.keys(CATEGORIES)) {
    if (category?.toLowerCase().includes(key.toLowerCase())) return CATEGORIES[key];
  }
  return CATEGORIES.Other;
}

// ── SVG icon builders ────────────────────────────────────────────
function createPropertyIcon() {
  const html = `<div class="property-marker">
    <div class="property-pulse"></div>
    <div class="property-label">SUBJECT PROPERTY</div>
    <div class="property-pin">
      <svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="pinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#e2c47a"/>
            <stop offset="100%" stop-color="#c9a84c"/>
          </linearGradient>
          <filter id="pinShadow" x="-20%" y="-10%" width="140%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.45"/>
          </filter>
        </defs>
        <path d="M18 43C18 43 34 27 34 16C34 8 27 2 18 2C9 2 2 8 2 16C2 27 18 43 18 43Z"
              fill="url(#pinGrad)" stroke="#0f1923" stroke-width="2" filter="url(#pinShadow)"/>
        <circle cx="18" cy="16" r="7" fill="#0f1923"/>
        <polygon points="18,11 19.5,14.5 23,14.8 20.3,17 21.1,20.5 18,18.7 14.9,20.5 15.7,17 13,14.8 16.5,14.5"
                 fill="#c9a84c"/>
      </svg>
    </div>
  </div>`;
  // Total height: ~30px label + 46px pin = 76px; width driven by label (~140px)
  return L.divIcon({
    html,
    className: '',
    iconSize: [140, 76],
    iconAnchor: [70, 76],
    popupAnchor: [0, -76],
  });
}

function createRetailerIcon(category) {
  const cfg = getCategoryConfig(category);
  const svg = `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 35C14 35 27 22 27 13C27 6 21 1 14 1C7 1 1 6 1 13C1 22 14 35 14 35Z"
          fill="${cfg.color}" stroke="#ffffff" stroke-width="1.5"/>
    <circle cx="14" cy="13" r="9" fill="#ffffff" opacity="0.5"/>
    <text x="14" y="17" text-anchor="middle" font-size="12">${cfg.emoji}</text>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
  });
}

// ── Logo-based marker icons ──────────────────────────────────────
// Map of normalized retailer names → logo filenames in /logos/
const LOGO_FILES = {
  'att': 'ATT.png',
  'at&t': 'ATT.png',
  'aarons': 'Aarons.png',
  "aaron's": 'Aarons.png',
  'anytime fitness': 'Anytime Fitness.png',
  "arby's": 'Arbys.png',
  'arbys': 'Arbys.png',
  'bp': 'BP.png',
  'barnes & noble': 'Barnes and Noble.png',
  'barnes and noble': 'Barnes and Noble.png',
  'big lots': 'Big Lots.png',
  'bob evans': 'Bob Evans.png',
  'bob evans restaurant': 'Bob Evans.png',
  'buffalo wild wings': 'Buffalo Wild Wings.png',
  'burger king': 'Burger King.png',
  'chase': 'Chase Bank.png',
  'chase bank': 'Chase Bank.png',
  'jpmorgan chase': 'Chase Bank.png',
  'the cheesecake factory': 'Cheesecake Factory.png',
  'cheesecake factory': 'Cheesecake Factory.png',
  'cracker barrel': 'Cracker Barrel.png',
  'cracker barrel old country store': 'Cracker Barrel.png',
  'cricket wireless': 'Cricket Wireless.png',
  'dairy queen': 'Dairy Queen.png',
  "denny's": 'Dennys.png',
  'dennys': 'Dennys.png',
  'dollar general': 'Dollar General.png',
  'dg market': 'DG Market.png',
  'dollar tree': 'Dollar Tree.png',
  "domino's": 'Dominos.png',
  "domino's pizza": 'Dominos.png',
  'dominos': 'Dominos.png',
  'family dollar': 'Family Dollar.png',
  'fifth third bank': 'Fifth Third Bank.png',
  'first national bank': 'First National Bank.png',
  'first watch': 'First Watch.png',
  'five guys': 'Five Guys.png',
  "gabe's": 'Gabes.png',
  'gabes': 'Gabes.png',
  'goodwill': 'Goodwill.png',
  'h&r block': 'HR Block.png',
  'hr block': 'HR Block.png',
  'harbor freight': 'Harbor Freight.png',
  'harbor freight tools': 'Harbor Freight.png',
  'hobby lobby': 'Hobby Lobby.png',
  'home depot': 'Home Depot.png',
  'the home depot': 'Home Depot.png',
  'huntington bank': 'Huntington Bank.png',
  'ihop': 'IHOP.png',
  "jimmy john's": 'Jimmy Johns.png',
  'jimmy johns': 'Jimmy Johns.png',
  "kohl's": 'Kohls.png',
  'kohls': 'Kohls.png',
  'kroger': 'Kroger.png',
  'la fitness': 'LA Fitness.png',
  "lowe's": 'Lowes.png',
  "lowe's home improvement": 'Lowes.png',
  'lowes': 'Lowes.png',
  'marshalls': 'Marshalls.png',
  "moe's southwest grill": 'Moes Grill.png',
  'moes grill': 'Moes Grill.png',
  "ollie's bargain outlet": 'Ollies.png',
  'ollies': 'Ollies.png',
  'pnc': 'PNC.png',
  'pnc bank': 'PNC.png',
  'panda express': 'Panda Express.png',
  'panera bread': 'Panera Bread.png',
  'panera': 'Panera Bread.png',
  "papa john's": 'Papa Johns.png',
  'papa johns': 'Papa Johns.png',
  'pep boys': 'Pep Boys.png',
  'pizza hut': 'Pizza Hut.png',
  'planet fitness': 'Planet Fitness.png',
  'primanti bros': 'Primanti Bros.png',
  "primanti brothers": 'Primanti Bros.png',
  "primanti bros.": 'Primanti Bros.png',
  'qdoba': 'Qdoba.png',
  'qdoba mexican eats': 'Qdoba.png',
  'qdoba mexican grill': 'Qdoba.png',
  'rei': 'REI.png',
  'red robin': 'Red Robin.png',
  'red robin gourmet burgers': 'Red Robin.png',
  'rite aid': 'Rite Aid.png',
  'rural king': 'Rural King.png',
  "sam's club": 'Sams Club.png',
  'sams club': 'Sams Club.png',
  'shop n save': 'Shop n Save.png',
  "shop 'n save": 'Shop n Save.png',
  'state farm': 'State Farm.png',
  "steak 'n shake": 'Steak n Shake.png',
  'steak n shake': 'Steak n Shake.png',
  'subway': 'Subway.png',
  'sunoco': 'Sunoco.png',
  'tj maxx': 'TJ Maxx.png',
  't.j. maxx': 'TJ Maxx.png',
  'taco bell': 'Taco Bell.png',
  'target': 'Target.png',
  'texas roadhouse': 'Texas Roadhouse.png',
  'tim hortons': 'Tim Hortons.png',
  'tractor supply': 'Tractor Supply Company.png',
  'tractor supply co.': 'Tractor Supply Company.png',
  'tractor supply company': 'Tractor Supply Company.png',
  'urban air': 'Urban Air.png',
  'urban outfitters': 'Urban Outfitters.png',
  'verizon': 'Verizon.png',
  'verizon wireless': 'Verizon.png',
  'walgreens': 'Walgreens.png',
  'walmart': 'Walmart.png',
  'walmart supercenter': 'Walmart.png',
  'walmart neighborhood market': 'Walmart.png',
  'white castle': 'White Castle.png',
  'american freight': 'American Freight.png',
  "einstein bros. bagels": 'Einstein Bros Bagels.png',
  'einstein bros bagels': 'Einstein Bros Bagels.png',
  'bealls outlet': 'Bealls Outlet.png',
  "dunham's sports": 'Dunhams Sports.png',
  'dunhams sports': 'Dunhams Sports.png',
  "sportsman's warehouse": 'Sportsmans Warehouse.png',
  'sportsmans warehouse': 'Sportsmans Warehouse.png',
  'rent-a-center': 'Rent-A-Center.png',
  'smokey bones': 'Smokey Bones.png',
  'upmc': 'UPMC.png',
  'napa auto parts': 'NAPA Auto Parts.png',
  'napa': 'NAPA Auto Parts.png',
  "o'reilly auto parts": 'OReilly Auto Parts.png',
  'oreilly auto parts': 'OReilly Auto Parts.png',
  "dunkin'": 'Dunkin.png',
  'dunkin': 'Dunkin.png',
  "dunkin' donuts": 'Dunkin.png',
  'dunkin donuts': 'Dunkin.png',
  'sheetz': 'Sheetz.png',
  'sherwin-williams': 'Sherwin-Williams.png',
  'sherwin williams': 'Sherwin-Williams.png',
  'salvation army': 'Salvation Army.png',
  'the salvation army': 'Salvation Army.png',
  'true value': 'True Value.png',
  'true value of latrobe': 'True Value.png',
  "fox's pizza den": 'Foxs Pizza.png',
  'foxs pizza den': 'Foxs Pizza.png',
  "fox's pizza": 'Foxs Pizza.png',
  'foxs pizza': 'Foxs Pizza.png',
  // ── Additional major brands ──
  "mcdonald's": 'McDonalds.png',
  'mcdonalds': 'McDonalds.png',
  '7-eleven': '7-Eleven.png',
  '7 eleven': '7-Eleven.png',
  'kfc': 'KFC.png',
  'kentucky fried chicken': 'KFC.png',
  "wendy's": 'Wendys.png',
  'wendys': 'Wendys.png',
  'starbucks': 'Starbucks.png',
  'starbucks coffee': 'Starbucks.png',
  'cvs': 'CVS.png',
  'cvs pharmacy': 'CVS.png',
  'cvs health': 'CVS.png',
  'aldi': 'ALDI.png',
  'giant eagle': 'Giant Eagle.png',
  'giant eagle supermarket': 'Giant Eagle.png',
  "jersey mike's": 'Jersey Mikes.png',
  'jersey mikes': 'Jersey Mikes.png',
  "jersey mike's subs": 'Jersey Mikes.png',
  'petsmart': 'PetSmart.png',
  'advance auto parts': 'Advance Auto Parts.png',
  'circle k': 'Circle K.png',
  'sonic': 'Sonic.png',
  'sonic drive-in': 'Sonic.png',
  'getgo': 'GetGo.png',
  'get go': 'GetGo.png',
  'petco': 'Petco.png',
  'chick-fil-a': 'Chick-fil-A.png',
  'chickfila': 'Chick-fil-A.png',
  'chipotle': 'Chipotle.png',
  'chipotle mexican grill': 'Chipotle.png',
  "applebee's": 'Applebees.png',
  'applebees': 'Applebees.png',
  'olive garden': 'Olive Garden.png',
  "popeyes": 'Popeyes.png',
  "popeye's": 'Popeyes.png',
  'popeyes louisiana kitchen': 'Popeyes.png',
  // ── Additional unmapped brands ──
  'autozone': 'AutoZone.png',
  'auto zone': 'AutoZone.png',
  'pet supplies plus': 'Pet Supplies Plus.png',
  'speedway': 'Speedway.png',
  'valvoline': 'Valvoline.png',
  'valvoline instant oil change': 'Valvoline.png',
  'citizens bank': 'Citizens Bank.png',
  'citizens': 'Citizens Bank.png',
  'family dollar / dollar tree': 'Family Dollar Dollar Tree.png',
  'family dollar/dollar tree': 'Family Dollar Dollar Tree.png',
  // Hotels & lodging
  'best western plus': 'Best Western Plus.png',
  'best western': 'Best Western Plus.png',
  'cambria hotels': 'Cambria Hotels.png',
  'cambria hotel': 'Cambria Hotels.png',
  'candlewood suites': 'Candlewood Suites.png',
  'clarion inn': 'Clarion Inn.png',
  'comfort inn': 'Comfort Inn.png',
  'comfort inn & suites': 'Comfort Inn.png',
  'courtyard by marriott': 'Courtyard by Marriott.png',
  'courtyard marriott': 'Courtyard by Marriott.png',
  'doubletree by hilton': 'DoubleTree by Hilton.png',
  'doubletree': 'DoubleTree by Hilton.png',
  'even hotel': 'Even Hotel.png',
  'extended stay america': 'Extended Stay America Select Suites.png',
  'extended stay america select suites': 'Extended Stay America Select Suites.png',
  'hampton inn & suites': 'Hampton Inn & Suites.png',
  'hampton inn': 'Hampton Inn & Suites.png',
  'hilton garden inn': 'Hilton Garden Inn.png',
  'home2 suites by hilton': 'Home2 Suites by Hilton.png',
  'home2 suites': 'Home2 Suites by Hilton.png',
  'marriott': 'Marriott.png',
  'omni hotel': 'Omni Hotel.png',
  'omni': 'Omni Hotel.png',
  'premier suites': 'Premier Suites.png',
  'quality inn': 'Quality Inn.png',
  'quality inn & suites': 'Quality Inn.png',
  'red roof inn': 'Red Roof Inn.png',
  'residence inn by marriott': 'Residence Inn by Marriott.png',
  'residence inn': 'Residence Inn by Marriott.png',
  'staybridge suites': 'Staybridge Suites.png',
  'towneplace suites by marriott': 'TownePlace Suites by Marriott.png',
  'towneplace suites': 'TownePlace Suites by Marriott.png',
  'wingate by wyndham': 'Wingate by Wyndham.png',
  // Local/regional restaurants & businesses
  'bravo cucina italiana': 'Bravo Cucina Italiana.png',
  'bravo': 'Bravo Cucina Italiana.png',
  'brighton hot dog shoppe': 'Brighton Hot Dog Shoppe.png',
  'burgatory': 'Burgatory.png',
  'busy beaver': 'Busy Beaver.png',
  'busy beaver building centers': 'Busy Beaver.png',
  'china wok': 'China Wok.png',
  'commonplace coffee': 'Commonplace Coffee.png',
  'duquesne university': 'Duquesne University.png',
  'fnb financial center': 'FNB Financial Center.png',
  'fnb': 'FNB Financial Center.png',
  'first national bank financial center': 'FNB Financial Center.png',
  'hofbrauhaus': 'Hofbrauhaus.png',
  'hofbrauhaus pittsburgh': 'Hofbrauhaus.png',
  "jason's deli": 'Jasons Deli.png',
  'jasons deli': 'Jasons Deli.png',
  "jeni's ice cream": 'Jenis Ice Cream.png',
  "jeni's splendid ice creams": 'Jenis Ice Cream.png',
  'jenis ice cream': 'Jenis Ice Cream.png',
  'juniper grill': 'Juniper Grill.png',
  'kura sushi': 'Kura Sushi.png',
  'mad mex': 'Mad Mex.png',
  'nextier bank': 'NexTier Bank.png',
  'over the bar': 'Over the Bar.png',
  'over the bar bicycle cafe': 'Over the Bar.png',
  'ppg paints arena': 'PPG Paints Arena.png',
  'patron mexican grill': 'Patron Mexican Grill.png',
  'pins mechanical': 'Pins Mechanical.png',
  'pins mechanical co': 'Pins Mechanical.png',
  'pizza bosa': 'Pizza Bosa.png',
  "pizza joe's": 'Pizza Joes.png',
  'pizza joes': 'Pizza Joes.png',
  'pizza milano': 'Pizza Milano.png',
  'saga hibachi': 'Saga Hibachi.png',
  'sakura japanese steakhouse': 'Sakura Japanese Steakhouse.png',
  'sakura': 'Sakura Japanese Steakhouse.png',
  "salem's": 'Salems.png',
  'salems': 'Salems.png',
  "salem's market": 'Salems.png',
  'speckled egg': 'Speckled Egg.png',
  'the speckled egg': 'Speckled Egg.png',
  'tepache': 'Tepache.png',
  'waffles incaffeinated': 'Waffles INCaffeinated.png',
};

function getLogoUrl(retailerName) {
  const normalized = retailerName.toLowerCase().trim();
  // Direct match
  if (LOGO_FILES[normalized]) return `/logos/${LOGO_FILES[normalized]}`;
  // Try without trailing punctuation/suffixes
  for (const [key, file] of Object.entries(LOGO_FILES)) {
    if (normalized.startsWith(key) || key.startsWith(normalized)) {
      return `/logos/${file}`;
    }
  }
  return null;
}

const LOGO_H = 56; // Fixed height for all logo markers
const LOGO_MIN_W = 56; // Minimum width (square)
const LOGO_MAX_W = 130; // Maximum width (very wide logos)

// Cache of logo natural dimensions: url → { w, h, aspect }
const logoDimCache = {};

function preloadLogo(url) {
  if (logoDimCache[url]) return Promise.resolve(logoDimCache[url]);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const aspect = img.naturalWidth / img.naturalHeight;
      logoDimCache[url] = { w: img.naturalWidth, h: img.naturalHeight, aspect };
      resolve(logoDimCache[url]);
    };
    img.onerror = () => {
      logoDimCache[url] = { w: 1, h: 1, aspect: 1 };
      resolve(logoDimCache[url]);
    };
    img.src = url;
  });
}

// Get marker width for a logo based on its natural aspect ratio
function getLogoMarkerW(logoUrl) {
  const cached = logoDimCache[logoUrl];
  if (!cached) return LOGO_MIN_W;
  // Scale width to maintain aspect ratio at fixed height
  const innerH = LOGO_H - 19; // padding (8px×2) + border (1.5px×2) overhead
  const naturalW = innerH * cached.aspect + 19; // add back padding + border
  return Math.max(LOGO_MIN_W, Math.min(LOGO_MAX_W, Math.round(naturalW)));
}

function createLogoIcon(logoUrl) {
  const markerW = getLogoMarkerW(logoUrl);
  // Inner dimensions after padding (8px) and border (1.5px) on each side
  const innerW = markerW - 19;
  const innerH = LOGO_H - 19;

  return L.divIcon({
    html: `<div class="logo-marker" style="width:${markerW}px;height:${LOGO_H}px;"><img src="${logoUrl}" alt="" width="${innerW}" height="${innerH}" style="object-fit:contain;" onerror="this.style.display='none'" /></div>`,
    className: '',
    iconSize: [markerW, LOGO_H],
    iconAnchor: [markerW / 2, LOGO_H / 2],
    popupAnchor: [0, -LOGO_H / 2],
  });
}


// ── Smart Clustering + Collision-Avoidance System ────────────────
// Groups overlapping markers into clusters, then displaces clusters/singles
// so the subject property is never blocked and the map stays clean.

const MARKER_PAD = 8;
const CLUSTER_CELL = 52;       // px per logo cell inside cluster grid
const CLUSTER_GAP = 5;         // px gap between cells
const CLUSTER_PAD = 8;         // px padding inside cluster border
const MAX_CLUSTER_COLS = 3;    // max columns in cluster grid
const MAX_CLUSTER_SIZE = 6;    // max items per cluster (split larger ones)
const MIN_CLUSTER_SIZE = 3;    // minimum items to form a cluster (pairs just push apart)

// Zoom-adaptive extra padding for merge detection:
// At low zoom we pad more so distant markers merge sooner
function getClusterPadding(zoom) {
  if (zoom >= 16) return 4;   // tight: only merge if truly overlapping
  if (zoom >= 14) return 10;
  if (zoom >= 12) return 18;
  return 28;                   // far out: merge aggressively
}

// SVG renderer for connecting lines (html2canvas captures SVG DOM elements reliably)
const svgRenderer = L.svg ? L.svg({ padding: 0.5 }) : undefined;

// ── Step 1: Group nearby markers into clusters (pixel space) ─────
function buildClusters(map, items) {
  const zoom = map.getZoom();
  const pad = getClusterPadding(zoom);

  // Convert to pixel positions with bounding box sizes
  const nodes = items.map((item, i) => {
    const pt = map.latLngToContainerPoint(item.position);
    const w = (item.markerW || LOGO_MIN_W) + MARKER_PAD;
    const h = LOGO_H + MARKER_PAD;
    return { ...item, px: pt.x, py: pt.y, w, h, clusterId: i };
  });

  // Union-find for merging
  const parent = nodes.map((_, i) => i);
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) { parent[find(a)] = find(b); }

  // Merge nodes whose bounding boxes overlap (+ zoom-adaptive padding)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const ni = nodes[i], nj = nodes[j];
      const overlapX = (ni.w + nj.w) / 2 + pad - Math.abs(ni.px - nj.px);
      const overlapY = (ni.h + nj.h) / 2 + pad - Math.abs(ni.py - nj.py);
      if (overlapX > 0 && overlapY > 0) {
        union(i, j);
      }
    }
  }

  // Group by cluster root
  const rawGroups = {};
  nodes.forEach((node, i) => {
    const root = find(i);
    if (!rawGroups[root]) rawGroups[root] = [];
    rawGroups[root].push(node);
  });

  // Split oversized clusters into smaller chunks
  // Also break up small groups (< MIN_CLUSTER_SIZE) back into singles
  const groups = [];
  Object.values(rawGroups).forEach((members) => {
    if (members.length < MIN_CLUSTER_SIZE) {
      // Pairs & singles stay as individual markers — displacement handles overlap
      members.forEach((m) => groups.push([m]));
    } else if (members.length <= MAX_CLUSTER_SIZE) {
      groups.push(members);
    } else {
      members.sort((a, b) => a.py - b.py || a.px - b.px);
      for (let i = 0; i < members.length; i += MAX_CLUSTER_SIZE) {
        const chunk = members.slice(i, i + MAX_CLUSTER_SIZE);
        if (chunk.length < MIN_CLUSTER_SIZE) {
          chunk.forEach((m) => groups.push([m]));
        } else {
          groups.push(chunk);
        }
      }
    }
  });

  // Build cluster objects
  return groups.map((members) => {
    const cx = members.reduce((s, m) => s + m.px, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.py, 0) / members.length;
    const centroidLL = map.containerPointToLatLng([cx, cy]);

    if (members.length === 1) {
      const m = members[0];
      return {
        type: 'single',
        items: [m],
        cx, cy,
        centroidLatLng: [centroidLL.lat, centroidLL.lng],
        w: m.w,
        h: m.h,
      };
    }

    // Multi-marker cluster — compute grid dimensions
    const count = members.length;
    const cols = Math.min(count, MAX_CLUSTER_COLS);
    const rows = Math.ceil(count / cols);
    const gridW = cols * CLUSTER_CELL + (cols - 1) * CLUSTER_GAP + CLUSTER_PAD * 2;
    const gridH = rows * CLUSTER_CELL + (rows - 1) * CLUSTER_GAP + CLUSTER_PAD * 2;

    return {
      type: 'cluster',
      items: members,
      cx, cy,
      centroidLatLng: [centroidLL.lat, centroidLL.lng],
      w: gridW + MARKER_PAD,
      h: gridH + MARKER_PAD,
      cols, rows, gridW, gridH,
    };
  });
}

// ── Step 2: Create a cluster divIcon showing a mini logo grid ────
function createClusterGridIcon(cluster, childrenData) {
  const { items, cols, gridW, gridH } = cluster;
  const cells = items.map((item) => {
    const child = childrenData.find((c) => c && c.idx === item.idx);
    if (!child) return '<div class="sc-cell"></div>';
    const logoUrl = child.logoUrl;
    if (logoUrl) {
      return `<div class="sc-cell"><img src="${logoUrl}" alt="" width="44" height="44" style="object-fit:contain;" onerror="this.style.display='none'" /></div>`;
    }
    // No logo — show initials with category color background
    const cfg = getCategoryConfig(child.category || 'Other');
    const initials = (child.name || '?').substring(0, 2);
    return `<div class="sc-cell sc-cell-text" style="background:${cfg.color}33;color:${cfg.color}">${initials}</div>`;
  }).join('');

  return L.divIcon({
    html: `<div class="smart-cluster" style="width:${gridW}px;height:${gridH}px;grid-template-columns:repeat(${cols},${CLUSTER_CELL}px);">${cells}<div class="sc-count">${items.length}</div></div>`,
    className: '',
    iconSize: [gridW, gridH],
    iconAnchor: [gridW / 2, gridH / 2],
    popupAnchor: [0, -gridH / 2],
  });
}

// ── Step 3: Collision-avoidance (displace clusters + singles) ────
function rectsOverlap(a, b) {
  return !(a.x + a.w / 2 < b.x - b.w / 2 ||
           a.x - a.w / 2 > b.x + b.w / 2 ||
           a.y + a.h / 2 < b.y - b.h / 2 ||
           a.y - a.h / 2 > b.y + b.h / 2);
}

// Push two rects apart symmetrically (both move half the distance)
function pushBothApart(a, b) {
  let dx = a.x - b.x;
  let dy = a.y - b.y;
  const overlapX = (a.w + b.w) / 2 - Math.abs(dx);
  const overlapY = (a.h + b.h) / 2 - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return false;

  if (overlapX < overlapY) {
    const push = Math.sign(dx || 1) * (overlapX / 2 + 1);
    a.x += push;
    b.x -= push;
  } else {
    const push = Math.sign(dy || 1) * (overlapY / 2 + 1);
    a.y += push;
    b.y -= push;
  }
  return true;
}

// Push mover away from a pinned anchor (only mover moves)
function pushAwayFrom(mover, anchor) {
  let dx = mover.x - anchor.x;
  let dy = mover.y - anchor.y;
  const overlapX = (mover.w + anchor.w) / 2 - Math.abs(dx);
  const overlapY = (mover.h + anchor.h) / 2 - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return false;

  if (overlapX < overlapY) {
    mover.x += Math.sign(dx || 1) * (overlapX + 1);
  } else {
    mover.y += Math.sign(dy || 1) * (overlapY + 1);
  }
  return true;
}

function displaceClusterRects(map, clusters, propertyLatLng) {
  const rects = clusters.map((c, i) => ({
    x: c.cx, y: c.cy,
    w: c.w, h: c.h,
    origX: c.cx, origY: c.cy,
    idx: i,
  }));

  // Subject property rect (pinned, never moves)
  // The icon anchor is at [70, 76] (bottom-center), so the marker extends
  // 76px upward from the lat/lng point. Offset the rect center accordingly.
  const propPt = map.latLngToContainerPoint(propertyLatLng);
  const propW = 140 + MARKER_PAD * 2;
  const propH = 76 + MARKER_PAD * 2;
  const propRect = { x: propPt.x, y: propPt.y - propH / 2, w: propW, h: propH };

  for (let iter = 0; iter < 60; iter++) {
    let moved = false;

    // Push away from subject property first (full clear, highest priority)
    for (const r of rects) {
      if (rectsOverlap(r, propRect)) {
        pushAwayFrom(r, propRect);
        moved = true;
      }
    }

    // Push all markers/clusters apart from each other symmetrically
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (rectsOverlap(rects[i], rects[j])) {
          pushBothApart(rects[i], rects[j]);
          moved = true;
        }
      }
    }

    if (!moved) break;
  }

  return rects.map((r) => {
    const displacedLL = map.containerPointToLatLng([r.x, r.y]);
    const dist = Math.hypot(r.x - r.origX, r.y - r.origY);
    return {
      idx: r.idx,
      displacedLatLng: [displacedLL.lat, displacedLL.lng],
      wasDisplaced: dist > 3,
    };
  });
}

// ── Step 4: SmartClusterLayer component ──────────────────────────
function SmartClusterLayer({ children, onMarkerClick, markerRefs, propertyLatLng, connectorDataRef, isExportingRef }) {
  const map = useMap();
  const layerGroupRef = useRef(null);
  const linesGroupRef = useRef(null);
  // Store user drag overrides: key → [lat, lng]
  // Key is "s-{idx}" for singles, "c-{sorted idx list}" for clusters
  const dragOverrides = useRef({});
  // Track whether a drag just finished to suppress the moveend re-render
  const justDragged = useRef(false);

  useEffect(() => {
    const layers = L.layerGroup().addTo(map);
    const lines = L.layerGroup().addTo(map);
    layerGroupRef.current = layers;
    linesGroupRef.current = lines;
    return () => {
      map.removeLayer(layers);
      map.removeLayer(lines);
    };
  }, [map]);

  useEffect(() => {
    const layers = layerGroupRef.current;
    const lines = linesGroupRef.current;
    if (!layers || !lines) return;

    function getClusterKey(cluster) {
      if (cluster.type === 'single') return `s-${cluster.items[0].idx}`;
      return `c-${cluster.items.map((i) => i.idx).sort((a, b) => a - b).join(',')}`;
    }

    function render() {
      layers.clearLayers();
      lines.clearLayers();
      if (markerRefs) markerRefs.current = {};
      const connectors = []; // collect connector line data for export

      if (!Array.isArray(children) || children.length === 0 || !propertyLatLng) {
        if (connectorDataRef) connectorDataRef.current = [];
        return;
      }

      const propLL = L.latLng(propertyLatLng[0], propertyLatLng[1]);

      // Build item list
      const items = children.map((child) => ({
        position: L.latLng(child.position[0], child.position[1]),
        markerW: child.icon?.options?.iconSize?.[0] || LOGO_MIN_W,
        idx: child.idx,
      }));

      // Step 1: Build clusters
      const clusters = buildClusters(map, items);

      // Step 2: Displace clusters to avoid subject property + each other
      const displaced = displaceClusterRects(map, clusters, propLL);

      // Step 3: Render each cluster or single marker
      clusters.forEach((cluster, ci) => {
        const dp = displaced[ci];
        if (!dp) return;

        const clusterKey = getClusterKey(cluster);
        const overridePos = dragOverrides.current[clusterKey];
        const markerLatLng = overridePos || dp.displacedLatLng;

        // Show connector if user dragged this marker OR if collision algorithm displaced it
        const finalPt = map.latLngToContainerPoint(markerLatLng);
        const origPt = map.latLngToContainerPoint(cluster.centroidLatLng);
        const dist = Math.hypot(finalPt.x - origPt.x, finalPt.y - origPt.y);
        const isDisplaced = !!overridePos || dist > 5;

        if (cluster.type === 'single') {
          const item = cluster.items[0];
          const child = children.find((c) => c && c.idx === item.idx);
          if (!child) return;

          const marker = L.marker(markerLatLng, { icon: child.icon, draggable: true });
          if (child.popup) marker.bindPopup(child.popup);
          marker.on('click', () => {
            if (onMarkerClick) onMarkerClick(item.idx);
          });
          marker.on('dragstart', () => { justDragged.current = true; });
          marker.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            dragOverrides.current[clusterKey] = [pos.lat, pos.lng];
            justDragged.current = true;
            render();
          });
          if (markerRefs) markerRefs.current[`r-${item.idx}`] = marker;
          layers.addLayer(marker);
        } else {
          const icon = createClusterGridIcon(cluster, children);
          const marker = L.marker(markerLatLng, { icon, draggable: true });

          const names = cluster.items.map((item) => {
            const child = children.find((c) => c && c.idx === item.idx);
            return child?.name || '';
          }).filter(Boolean);
          marker.bindPopup(
            `<div class="popup-name">${names.length} Retailers</div>` +
            names.map((n) => `<div class="popup-address">${n}</div>`).join('')
          );

          marker.on('click', () => {
            if (cluster.items.length > 0 && onMarkerClick) {
              onMarkerClick(cluster.items[0].idx);
            }
          });
          marker.on('dragstart', () => { justDragged.current = true; });
          marker.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            dragOverrides.current[clusterKey] = [pos.lat, pos.lng];
            justDragged.current = true;
            render();
          });

          cluster.items.forEach((item) => {
            if (markerRefs) markerRefs.current[`r-${item.idx}`] = marker;
          });
          layers.addLayer(marker);
        }

        // Draw connector line from marker to actual map location
        if (isDisplaced) {
          // Store data for canvas-based export drawing
          connectors.push({
            from: Array.isArray(markerLatLng) ? markerLatLng : [markerLatLng.lat, markerLatLng.lng],
            to: Array.isArray(cluster.centroidLatLng) ? cluster.centroidLatLng : [cluster.centroidLatLng.lat, cluster.centroidLatLng.lng],
          });

          // Clean solid connector line
          const line = L.polyline(
            [markerLatLng, cluster.centroidLatLng],
            {
              weight: 1.5,
              color: '#333333',
              opacity: 0.7,
              interactive: false,
              renderer: svgRenderer,
            }
          );
          lines.addLayer(line);

          // Small filled dot at the actual location
          const dot = L.circleMarker(cluster.centroidLatLng, {
            radius: 4,
            fillColor: '#333333',
            fillOpacity: 0.9,
            stroke: true,
            color: '#ffffff',
            weight: 2,
            interactive: false,
            renderer: svgRenderer,
          });
          lines.addLayer(dot);
        }
      });

      // Expose connector data for canvas-based export drawing
      if (connectorDataRef) connectorDataRef.current = connectors;
    }

    render();

    // Debounced re-render on zoom/pan to avoid excessive recalculation
    let timer = null;
    const debouncedRender = () => {
      // Skip re-render during export or if triggered by a drag
      if ((isExportingRef && isExportingRef.current) || justDragged.current) {
        justDragged.current = false;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        render();
      }, 120);
    };

    const onZoom = () => {
      // Don't clear drag overrides during export — we need them preserved
      if (isExportingRef && isExportingRef.current) return;
      // Clear drag overrides on zoom since cluster composition may change
      dragOverrides.current = {};
      debouncedRender();
    };

    map.on('zoomend', onZoom);
    map.on('moveend', debouncedRender);

    return () => {
      if (timer) clearTimeout(timer);
      map.off('zoomend', onZoom);
      map.off('moveend', debouncedRender);
    };
  }, [children, onMarkerClick, markerRefs, propertyLatLng, map]);

  return null;
}

// ── Map helper component ─────────────────────────────────────────
function MapController({ flyTo, fitBounds }) {
  const map = useMap();
  useEffect(() => {
    if (fitBounds) {
      map.fitBounds(fitBounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [fitBounds, map]);
  useEffect(() => {
    if (flyTo) {
      map.flyTo(flyTo, 16, { duration: 0.8 });
    }
  }, [flyTo, map]);
  return null;
}

// ── Tile layer URLs ──────────────────────────────────────────────
const TILE_LAYERS = {
  street: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &mdash; Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    subdomains: undefined,
  },
};

function TileLayerSwitcher({ mapStyle }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }
    const cfg = TILE_LAYERS[mapStyle] || TILE_LAYERS.street;
    const opts = { attribution: cfg.attribution, maxZoom: 20 };
    if (cfg.subdomains) opts.subdomains = cfg.subdomains;
    layerRef.current = L.tileLayer(cfg.url, opts).addTo(map);
    // Ensure tile layer is behind markers
    layerRef.current.bringToBack();
    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [mapStyle, map]);

  return null;
}

// ── Property types ───────────────────────────────────────────────
const PROPERTY_TYPES = [
  'Retail Strip Center',
  'Anchored Shopping Center',
  'Inline Retail Space',
  'Pad Site / Outparcel',
  'Mixed-Use Development',
  'Urban / High Street Retail',
  'Neighborhood Center',
];

// ── Build the Claude prompt ──────────────────────────────────────
function buildPrompt(address, radius, propertyType, verifiedLat, verifiedLng) {
  const coordLine = verifiedLat != null
    ? `\nVERIFIED subject property coordinates: lat ${verifiedLat}, lng ${verifiedLng}. Use these exact coordinates for the property.`
    : '';
  return `You are a commercial real estate data expert with deep knowledge of national retail tenant locations across US markets.

Subject property: ${address}${coordLine}
Property type: ${propertyType}
Search radius: ${radius} miles

Task: Identify 25-35 national and regional retailers, restaurants, and services that actually operate within approximately ${radius} miles of this address. For each retailer provide: name, category, full street address, approximate lat, approximate lng, and distance_miles from the subject property.

Include a diverse mix of categories: grocery, pharmacy, fast food, casual dining, coffee, fitness, home improvement, banking, auto, entertainment, department store, discount/value, pet, cellular/tech, convenience.

Only include retailers that actually have locations in this specific area. Use real street addresses.

Return ONLY a raw JSON object with no markdown fences, no explanation, no preamble. The JSON must have this exact shape:
{ "property": { "lat": ${verifiedLat ?? 0.0}, "lng": ${verifiedLng ?? 0.0}, "display": "full address string" }, "retailers": [ { "name": "", "category": "", "address": "", "lat": 0.0, "lng": 0.0, "distance_miles": 0.0 } ] }`;
}

// ── CSV export ───────────────────────────────────────────────────
function exportCSV(property, retailers) {
  const lines = [];
  lines.push(`Subject Property,"${property.display}",${property.lat},${property.lng}`);
  lines.push('Name,Category,Address,Lat,Lng,Distance (mi)');
  retailers.forEach((r) => {
    lines.push(
      `"${r.name}","${r.category}","${r.address}",${r.lat},${r.lng},${r.distance_miles}`
    );
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = property.display
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 60);
  a.href = url;
  a.download = `${slug}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState('3');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [activeIdx, setActiveIdx] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [fitBounds, setFitBounds] = useState(null);

  // Filter state
  const [activeCategories, setActiveCategories] = useState(new Set());
  const [activeChainSizes, setActiveChainSizes] = useState(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mapStyle, setMapStyle] = useState('street'); // 'street' or 'satellite'

  const markerRefs = useRef({});
  const connectorDataRef = useRef([]);
  const isExportingRef = useRef(false);
  const cardRefs = useRef({});
  const mapRef = useRef(null);
  const mapPanelRef = useRef(null);

  // Available categories and chain sizes from current data
  const availableCategories = useMemo(() => {
    if (!data) return [];
    const cats = [...new Set(data.retailers.map((r) => r.category))];
    cats.sort();
    return cats;
  }, [data]);

  const availableChainSizes = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.retailers.map((r) => r.chainSize || 'Regional/Local'))];
  }, [data]);

  // Filtered retailers
  const filteredRetailers = useMemo(() => {
    if (!data) return [];
    return data.retailers.filter((r) => {
      if (activeCategories.size > 0 && !activeCategories.has(r.category)) return false;
      if (activeChainSizes.size > 0 && !activeChainSizes.has(r.chainSize || 'Regional/Local')) return false;
      return true;
    });
  }, [data, activeCategories, activeChainSizes]);

  // Toggle helpers
  const toggleCategory = useCallback((cat) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const toggleChainSize = useCallback((size) => {
    setActiveChainSizes((prev) => {
      const next = new Set(prev);
      if (next.has(size)) next.delete(size);
      else next.add(size);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveCategories(new Set());
    setActiveChainSizes(new Set());
  }, []);

  // Haversine distance
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 3958.8;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Generate map
  const handleGenerate = useCallback(async () => {
    if (!address.trim()) {
      setError('Please enter a property address.');
      return;
    }
    setError('');
    setLoading(true);
    setLoadingStatus('Geocoding subject property\u2026');
    setData(null);
    setActiveIdx(null);
    setFlyTo(null);
    setFitBounds(null);
    setActiveCategories(new Set());
    setActiveChainSizes(new Set());

    try {
      // Step 1: Geocode subject property via Nominatim
      let verifiedLat = null;
      let verifiedLng = null;
      try {
        const geoRes = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: address.trim() }),
        });
        const geoData = await geoRes.json();
        if (geoData.lat && geoData.lng) {
          verifiedLat = geoData.lat;
          verifiedLng = geoData.lng;
        }
      } catch {
        // Continue without verified coords
      }

      if (verifiedLat == null) {
        throw new Error('Could not geocode the subject property address. Please check the address and try again.');
      }

      // Step 2: Search nearby places via Google Places API
      setLoadingStatus('Searching nearby retailers\u2026');
      const res = await fetch('/api/places-nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: verifiedLat,
          lng: verifiedLng,
          radiusMiles: parseFloat(radius),
          propertyAddress: address.trim(),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `API returned ${res.status}`);
      }

      const parsed = await res.json();
      if (!parsed.property || !parsed.retailers) {
        throw new Error('Response missing required fields.');
      }

      if (parsed.retailers.length === 0) {
        throw new Error('No retailers found within the search radius. Try increasing the radius.');
      }

      // Preload all logo images so we know their dimensions for dynamic sizing
      const logoUrls = parsed.retailers
        .map((r) => getLogoUrl(r.name))
        .filter(Boolean);
      await Promise.all(logoUrls.map(preloadLogo));

      setData(parsed);

      // Build bounds
      const allPts = [
        [parsed.property.lat, parsed.property.lng],
        ...parsed.retailers.map((r) => [r.lat, r.lng]),
      ];
      setFitBounds(allPts);
    } catch (err) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }, [address, radius]);

  // Sidebar card click → fly to marker and open popup
  const handleCardClick = useCallback((idx) => {
    setActiveIdx(idx);
    const marker = markerRefs.current[`r-${idx}`];
    if (marker) {
      const ll = marker.getLatLng();
      setFlyTo([ll.lat, ll.lng]);
      setTimeout(() => {
        if (marker._map) marker.openPopup();
      }, 900);
    }
  }, []);

  // Map marker click → highlight sidebar card, scroll into view
  const handleMarkerClick = useCallback((idx) => {
    setActiveIdx(idx);
    const card = cardRefs.current[`c-${idx}`];
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

  // Fit all markers
  const handleFitAll = useCallback(() => {
    if (!data) return;
    const allPts = [
      [data.property.lat, data.property.lng],
      ...data.retailers.map((r) => [r.lat, r.lng]),
    ];
    setFitBounds([...allPts]); // spread to create new reference
  }, [data]);

  // Clear map
  const handleClear = useCallback(() => {
    setData(null);
    setActiveIdx(null);
    setFlyTo(null);
    setFitBounds(null);
    setError('');
  }, []);

  // Fix object-fit images for html2canvas (which doesn't support object-fit)
  function fixObjectFitForExport(container) {
    const imgs = container.querySelectorAll('.logo-marker img, .sc-cell img');
    const originals = [];
    imgs.forEach((img) => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const boxW = img.clientWidth || parseInt(img.style.width) || 44;
      const boxH = img.clientHeight || parseInt(img.style.height) || 44;
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const boxRatio = boxW / boxH;
      let drawW, drawH;
      if (imgRatio > boxRatio) {
        drawW = boxW;
        drawH = boxW / imgRatio;
      } else {
        drawH = boxH;
        drawW = boxH * imgRatio;
      }
      originals.push({ img, origStyle: img.getAttribute('style') });
      img.style.width = drawW + 'px';
      img.style.height = drawH + 'px';
      img.style.objectFit = 'fill';
    });
    return originals;
  }

  function restoreObjectFit(originals) {
    originals.forEach(({ img, origStyle }) => {
      img.setAttribute('style', origStyle);
    });
  }

  // ── Shared export helper: capture map at 8.5×11 landscape ────────
  // Standard letter landscape: 11in × 8.5in  →  aspect ratio 11:8.5
  const EXPORT_W = 11 * 300; // 3300px at 300 DPI
  const EXPORT_H = 8.5 * 300; // 2550px at 300 DPI

  const captureMapForExport = useCallback(async () => {
    if (!mapPanelRef.current) return null;
    // Prevent SmartClusterLayer from clearing drag overrides during export
    isExportingRef.current = true;
    const panel = mapPanelRef.current;
    const map = mapRef.current;

    // Hide ALL UI controls / overlays so only the map + markers show
    const hideSelectors = [
      '.map-controls',
      '.leaflet-control-zoom',
      '.leaflet-control-attribution',
      '.loading-bar',
      '.mobile-export-bar',
      '.mobile-menu-btn',
    ].join(', ');
    const hidden = panel.querySelectorAll(hideSelectors);
    const globalHidden = document.querySelectorAll(
      '.mobile-menu-btn, .sidebar-overlay, .sidebar'
    );
    hidden.forEach((el) => (el.style.display = 'none'));
    globalHidden.forEach((el) => (el.style.display = 'none'));

    // Save original map state so we can restore after capture
    const origCenter = map ? map.getCenter() : null;
    const origZoom = map ? map.getZoom() : null;
    const origCss = panel.style.cssText;
    const origAppCss = panel.parentElement?.style.cssText || '';

    // Force panel to landscape 11:8.5 aspect ratio using !important to
    // override any media-query rules (mobile sets width:100vw etc.)
    const CAPTURE_W = 1100;
    const CAPTURE_H = 850;
    panel.style.cssText = `
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      width: ${CAPTURE_W}px !important;
      height: ${CAPTURE_H}px !important;
      min-width: ${CAPTURE_W}px !important;
      min-height: ${CAPTURE_H}px !important;
      max-width: ${CAPTURE_W}px !important;
      max-height: ${CAPTURE_H}px !important;
      flex: none !important;
      overflow: hidden !important;
      z-index: 1 !important;
    `;
    // Also force the parent .app container so it doesn't constrain the panel
    if (panel.parentElement) {
      panel.parentElement.style.cssText = `
        position: relative !important;
        width: ${CAPTURE_W}px !important;
        height: ${CAPTURE_H}px !important;
        overflow: hidden !important;
      `;
    }

    // Let Leaflet know the container size changed
    if (map) {
      map.invalidateSize({ animate: false });
    }

    // Center on subject property and zoom to fit all retailers
    if (map && data) {
      const propLatLng = [data.property.lat, data.property.lng];
      const allPts = [
        propLatLng,
        ...data.retailers.map((r) => [r.lat, r.lng]),
      ];
      // Fit bounds with generous padding so logos aren't clipped at edges
      map.fitBounds(allPts, {
        padding: [60, 60],
        maxZoom: 15,
        animate: false,
      });

      // Nudge center toward subject property (weighted center: 60% property, 40% bounds center)
      const boundsCenter = map.getCenter();
      const weightedLat = propLatLng[0] * 0.6 + boundsCenter.lat * 0.4;
      const weightedLng = propLatLng[1] * 0.6 + boundsCenter.lng * 0.4;
      map.setView([weightedLat, weightedLng], map.getZoom(), { animate: false });
    }

    // Wait for tiles to load and layout to settle
    await new Promise((r) => setTimeout(r, 1000));
    if (map) {
      map.invalidateSize({ animate: false });
    }
    // Extra settle for tile rendering
    await new Promise((r) => setTimeout(r, 500));

    const fixed = fixObjectFitForExport(panel);
    try {
      // Capture at 3× for 300 DPI quality (1100×3 = 3300, 850×3 = 2550)
      const bgColor = mapStyle === 'satellite' ? '#1a2e1a' : '#f2efe9';
      const rawCanvas = await html2canvas(panel, {
        width: CAPTURE_W,
        height: CAPTURE_H,
        windowWidth: CAPTURE_W,
        windowHeight: CAPTURE_H,
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: bgColor,
      });

      // Guarantee output is exactly landscape letter at 300 DPI
      const outCanvas = document.createElement('canvas');
      outCanvas.width = EXPORT_W;   // 3300
      outCanvas.height = EXPORT_H;  // 2550
      const ctx = outCanvas.getContext('2d');
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
      ctx.drawImage(rawCanvas, 0, 0, EXPORT_W, EXPORT_H);

      // Draw connector lines directly on canvas (html2canvas can't capture Leaflet SVG overlay)
      if (map && connectorDataRef.current.length > 0) {
        const scaleX = EXPORT_W / CAPTURE_W;
        const scaleY = EXPORT_H / CAPTURE_H;
        connectorDataRef.current.forEach(({ from, to }) => {
          const fromPt = map.latLngToContainerPoint(L.latLng(from[0], from[1]));
          const toPt = map.latLngToContainerPoint(L.latLng(to[0], to[1]));
          const x1 = fromPt.x * scaleX, y1 = fromPt.y * scaleY;
          const x2 = toPt.x * scaleX, y2 = toPt.y * scaleY;

          // Clean solid connector line
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = 'rgba(51, 51, 51, 0.7)';
          ctx.lineWidth = 1.5 * scaleX;
          ctx.stroke();

          // Filled dot at the actual location
          const dotR = 4 * scaleX;
          ctx.beginPath();
          ctx.arc(x2, y2, dotR, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(51, 51, 51, 0.9)';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 * scaleX;
          ctx.stroke();
        });
      }

      return outCanvas;
    } finally {
      restoreObjectFit(fixed);
      // Restore original styles
      panel.style.cssText = origCss;
      if (panel.parentElement) {
        panel.parentElement.style.cssText = origAppCss;
      }
      hidden.forEach((el) => (el.style.display = ''));
      globalHidden.forEach((el) => (el.style.display = ''));
      // Re-enable SmartClusterLayer event handlers BEFORE restoring view
      isExportingRef.current = false;
      // Restore original map view and size
      if (map) {
        map.invalidateSize({ animate: false });
        if (origCenter && origZoom != null) {
          map.setView(origCenter, origZoom, { animate: false });
        }
      }
    }
  }, [data, mapStyle]);

  // Export map as high-res PNG (8.5×11 landscape)
  const handleExportImage = useCallback(async () => {
    try {
      const canvas = await captureMapForExport();
      if (!canvas) return;
      const slug = data?.property?.display
        ?.replace(/[^a-zA-Z0-9]+/g, '_')
        ?.replace(/^_|_$/g, '')
        ?.substring(0, 40) || 'retailer_map';
      const filename = `${slug}_map.png`;

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('Export error:', err);
    }
  }, [data, captureMapForExport]);

  // Export map as PDF (8.5×11 landscape, full-bleed)
  const handleExportPDF = useCallback(async () => {
    try {
      const canvas = await captureMapForExport();
      if (!canvas) return;
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();  // 11
      const pageH = pdf.internal.pageSize.getHeight(); // 8.5
      // Image is already exactly 11:8.5 so it fills the page edge-to-edge
      pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH);
      const slug = data?.property?.display
        ?.replace(/[^a-zA-Z0-9]+/g, '_')
        ?.replace(/^_|_$/g, '')
        ?.substring(0, 40) || 'retailer_map';
      pdf.save(`${slug}_map.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
    }
  }, [data, captureMapForExport]);

  return (
    <div className="app">
      {/* ─── Mobile hamburger ─── */}
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? '\u2715' : '\u2630'}
      </button>

      {/* ─── Mobile overlay ─── */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ─── Sidebar ─── */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ' collapsed'}`}>
        <div className="sidebar-header">
          <div className="brand-text">
            <div className="brand-name">The Colony Agency</div>
            <div className="brand-subtitle">Retailer Map Generator</div>
          </div>
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? '\u2039' : '\u203A'}
          </button>
        </div>

        {/* Form */}
        <div className="form-section">
          <div className="step-label"><span className="step-number">1</span> Search</div>
          <div className="form-group">
            <label className="form-label">Address</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. 533 Depot St, Latrobe, PA"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Radius</label>
            <select
              className="form-select"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
            >
              <option value="1">1 Mile</option>
              <option value="2">2 Miles</option>
              <option value="3">3 Miles</option>
              <option value="5">5 Miles</option>
            </select>
          </div>
          <button
            className="btn-generate"
            disabled={loading}
            onClick={handleGenerate}
          >
            {loading ? 'Generating\u2026' : 'Generate Map'}
          </button>
          {error && <div className="error-msg">{error}</div>}
        </div>

        {/* Filter Section */}
        <div className={`filter-section${data ? '' : ' disabled-section'}`}>
          <div className="step-label"><span className="step-number">2</span> Filter Results</div>
          {data ? (
            <div className="filter-body">
              <div className="filter-summary">
                <span className="list-count">
                  {filteredRetailers.length}
                  {filteredRetailers.length !== data.retailers.length
                    ? ` / ${data.retailers.length}`
                    : ''}{' '}
                  retailers found
                </span>
                {(activeCategories.size > 0 || activeChainSizes.size > 0) && (
                  <button className="filter-clear" onClick={clearFilters}>
                    Clear
                  </button>
                )}
              </div>
              <div className="filter-group">
                <div className="filter-label">Type</div>
                <div className="filter-chips">
                  {availableChainSizes.map((size) => (
                    <button
                      key={size}
                      className={`filter-chip${activeChainSizes.has(size) ? ' active' : ''}`}
                      onClick={() => toggleChainSize(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-group">
                <div className="filter-label">Category</div>
                <div className="filter-chips">
                  {availableCategories.map((cat) => {
                    const cfg = getCategoryConfig(cat);
                    return (
                      <button
                        key={cat}
                        className={`filter-chip${activeCategories.has(cat) ? ' active' : ''}`}
                        style={activeCategories.has(cat) ? { borderColor: cfg.color, background: cfg.color + '22' } : {}}
                        onClick={() => toggleCategory(cat)}
                      >
                        {cfg.emoji} {cat}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="step-hint">Generate a map to see filter options</div>
          )}
        </div>

        {/* Retailer List */}
        <div className="retailer-list-section">
          {data ? (
            <>
              <div className="list-header">
                Retailers
                <span className="list-count">
                  {filteredRetailers.length}
                  {filteredRetailers.length !== data.retailers.length
                    ? ` / ${data.retailers.length}`
                    : ''}{' '}
                  found
                </span>
              </div>

              <div className="retailer-list">
                {filteredRetailers.map((r) => {
                  const origIdx = data.retailers.indexOf(r);
                  const cfg = getCategoryConfig(r.category);
                  return (
                    <div
                      key={origIdx}
                      ref={(el) => (cardRefs.current[`c-${origIdx}`] = el)}
                      className={`retailer-card${activeIdx === origIdx ? ' active' : ''}`}
                      onClick={() => handleCardClick(origIdx)}
                    >
                      <div
                        className="card-dot"
                        style={{ background: cfg.color }}
                      />
                      <div className="card-info">
                        <div className="card-name">
                          {r.name}
                          {r.chainSize === 'National' && (
                            <span className="chain-badge national">National</span>
                          )}
                        </div>
                        <div className="card-category">{r.category}</div>
                        <div className="card-address">{r.address}</div>
                      </div>
                      <div className="card-distance">
                        {r.distance_miles.toFixed(1)} mi
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        {/* Export */}
        <div className={`export-section${data ? '' : ' disabled-section'}`}>
          <div className="step-label"><span className="step-number">3</span> Export</div>
          <div className="export-buttons">
            <button
              className="btn-export primary"
              disabled={!data}
              onClick={handleExportImage}
            >
              Export PNG
            </button>
            <button
              className="btn-export primary"
              disabled={!data}
              onClick={handleExportPDF}
            >
              Export PDF
            </button>
            <button
              className="btn-export"
              disabled={!data}
              onClick={() => data && exportCSV(data.property, data.retailers)}
            >
              Export CSV
            </button>
          </div>
        </div>
      </aside>

      {/* ─── Map Panel ─── */}
      <div className={`map-panel${mapStyle === 'satellite' ? ' satellite' : ''}`} ref={mapPanelRef}>
        {data && (
          <div className="map-controls">
            <button
              className="map-btn"
              onClick={() => setMapStyle((s) => s === 'street' ? 'satellite' : 'street')}
            >
              {mapStyle === 'street' ? 'Satellite' : 'Street Map'}
            </button>
            <button className="map-btn" onClick={handleFitAll}>
              Fit All
            </button>
            <button className="map-btn" onClick={handleClear}>
              Clear
            </button>
          </div>
        )}

        <MapContainer
          center={[40.4406, -79.9959]}
          zoom={12}
          style={{ width: '100%', height: '100%' }}
          ref={mapRef}
          tap={false}
        >
          <TileLayerSwitcher mapStyle={mapStyle} />
          <MapController flyTo={flyTo} fitBounds={fitBounds} />

          {/* Subject property marker (highest z-index) */}
          {data && (
            <Marker
              position={[data.property.lat, data.property.lng]}
              icon={createPropertyIcon()}
              zIndexOffset={10000}
            >
              <Popup>
                <div className="popup-name">Subject Property</div>
                <div className="popup-address">{data.property.display}</div>
              </Popup>
            </Marker>
          )}

          {/* Retailer markers (smart clusters + collision avoidance) */}
          <SmartClusterLayer
            onMarkerClick={handleMarkerClick}
            markerRefs={markerRefs}
            propertyLatLng={data ? [data.property.lat, data.property.lng] : null}
            connectorDataRef={connectorDataRef}
            isExportingRef={isExportingRef}
          >
            {data?.retailers.map((r, i) => {
              if (!filteredRetailers.includes(r)) return null;
              const cfg = getCategoryConfig(r.category);
              const logoUrl = getLogoUrl(r.name);
              return {
                position: [r.lat, r.lng],
                icon: logoUrl ? createLogoIcon(logoUrl) : createRetailerIcon(r.category),
                idx: i,
                name: r.name,
                category: r.category,
                logoUrl: logoUrl || null,
                popup: `<div class="popup-name">${r.name}</div>
                  <div class="popup-category" style="color:${cfg.color}">${cfg.emoji} ${r.category}</div>
                  <div class="popup-address">${r.address}</div>
                  <div class="popup-distance">${r.distance_miles.toFixed(1)} miles from property</div>`,
              };
            }).filter(Boolean)}
          </SmartClusterLayer>
        </MapContainer>

        {loading && (
          <div className="loading-bar">
            <div className="spinner" />
            <div className="loading-text">{loadingStatus || 'Generating retailer map\u2026'}</div>
          </div>
        )}

        {/* Mobile export bar */}
        {data && (
          <div className="mobile-export-bar">
            <button className="btn-export primary" onClick={handleExportImage}>PNG</button>
            <button className="btn-export primary" onClick={handleExportPDF}>PDF</button>
            <button className="btn-export" onClick={() => exportCSV(data.property, data.retailers)}>CSV</button>
          </div>
        )}
      </div>
    </div>
  );
}
