import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  MapContainer,
  Circle,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { RETAILER_DOMAINS, LOGO_FILES, getLogoUrl, getFallbackLogoUrl, preloadLogo, getLogoMarkerW, createLogoIcon, LOGO_H, LOGO_MIN_W, LOGO_MAX_W } from './logos.js';
import { CATEGORIES, getCategoryConfig, createRetailerIcon, MARKER_PAD, SmartClusterLayer } from './clustering.js';

// ── SVG icon builders ────────────────────────────────────────────
function getStreetAddress(fullAddress) {
  if (!fullAddress) return 'SUBJECT PROPERTY';
  // Extract street portion: everything before the city/state/zip
  // Typically "123 Main St, City, ST 12345" → "123 Main St"
  const parts = fullAddress.split(',');
  return parts[0].trim() || 'SUBJECT PROPERTY';
}

function createPropertyIcon(streetAddress) {
  const label = streetAddress || 'SUBJECT PROPERTY';
  // Estimate label width: ~9.5px per character (11px uppercase + 1.5px letter-spacing), min 140px
  const labelW = Math.max(140, label.length * 9.5 + 28);
  const html = `<div class="property-marker">
    <div class="property-pulse"></div>
    <div class="property-label">${label}</div>
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
  // Total height: ~30px label + 46px pin = 76px
  return L.divIcon({
    html,
    className: '',
    iconSize: [labelW, 76],
    iconAnchor: [labelW / 2, 76],
    popupAnchor: [0, -76],
  });
}

// ── Logo-based marker icons ──────────────────────────────────────
// BrandFetch CDN client ID for dynamic logo fetching
const BRANDFETCH_ID = '1idmdqs82nFxq8ItTXO';

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
  // Read URL params for automation (Puppeteer can pass ?style=satellite)
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialStyle = urlParams.get('style') || 'street';

  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState('1');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [activeIdx, setActiveIdx] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [fitBounds, setFitBounds] = useState(null);

  // Filter state
  const [activeCategories, setActiveCategories] = useState(new Set());
  const [activeChainSizes, setActiveChainSizes] = useState(new Set(['National']));
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mapStyle, setMapStyle] = useState(initialStyle); // 'street' or 'satellite' (reads from ?style= URL param)

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
    setActiveChainSizes(new Set(['National']));

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

    // Center on subject property with the radius ring fully visible + clean margins.
    // Strategy: fit to ring bounds first (guarantees ring visibility), then zoom out
    // further only if retailers fall outside. Always re-center on property.
    if (map && data) {
      const propLatLng = [data.property.lat, data.property.lng];
      const radiusMeters = parseFloat(radius) * 1609.34;
      const degLat = radiusMeters / 111320;
      const degLng = radiusMeters / (111320 * Math.cos(data.property.lat * Math.PI / 180));
      const RING_PADDING = 42; // px margin around ring on all sides

      // Step 1: Fit to ring bounds — this zoom guarantees the full ring is visible
      const ringBounds = [
        [data.property.lat - degLat, data.property.lng - degLng],
        [data.property.lat + degLat, data.property.lng + degLng],
      ];
      map.fitBounds(ringBounds, { padding: [RING_PADDING, RING_PADDING], maxZoom: 15, animate: false });
      const ringZoom = map.getZoom();

      // Step 2: Fit to all VISIBLE points (ring + filtered retailers) — may zoom out further for outliers
      const visibleRetailers = filteredRetailers.length > 0 ? filteredRetailers : data.retailers;
      const allPts = [propLatLng, ...ringBounds, ...visibleRetailers.map((r) => [r.lat, r.lng])];
      map.fitBounds(allPts, { padding: [RING_PADDING, RING_PADDING], maxZoom: 15, animate: false });
      const allZoom = map.getZoom();

      // Use whichever zoom is more zoomed out (smaller number)
      const finalZoom = Math.min(ringZoom, allZoom);
      map.setView(propLatLng, finalZoom, { animate: false });
    }

    // Wait for layout to settle, then force Leaflet to fully recalculate
    await new Promise((r) => setTimeout(r, 500));
    if (map) {
      map.invalidateSize({ animate: false });

      if (data) {
        const propLatLng = [data.property.lat, data.property.lng];
        const radiusMeters = parseFloat(radius) * 1609.34;
        const degLat = radiusMeters / 111320;
        const degLng = radiusMeters / (111320 * Math.cos(data.property.lat * Math.PI / 180));
        const RING_PADDING = 42;

        // Fit to ring bounds first — guarantees ring fully visible
        const ringBounds = [
          [data.property.lat - degLat, data.property.lng - degLng],
          [data.property.lat + degLat, data.property.lng + degLng],
        ];
        map.fitBounds(ringBounds, { padding: [RING_PADDING, RING_PADDING], maxZoom: 15, animate: false });
        const ringZoom = map.getZoom();

        // Also fit to all VISIBLE retailers — may zoom out further for outliers
        const visibleRetailers = filteredRetailers.length > 0 ? filteredRetailers : data.retailers;
        const allPts = [propLatLng, ...ringBounds, ...visibleRetailers.map((r) => [r.lat, r.lng])];
        map.fitBounds(allPts, { padding: [RING_PADDING, RING_PADDING], maxZoom: 15, animate: false });
        const allZoom = map.getZoom();

        const finalZoom = Math.min(ringZoom, allZoom);

        // Force a complete pixel-origin reset so SVG overlays
        // re-render at the correct position after container resize
        map.setView(propLatLng, finalZoom, { animate: false });
        map.invalidateSize({ animate: false });
        // Nudge zoom to force Leaflet to recalculate all SVG transforms
        map.setZoom(finalZoom - 0.01, { animate: false });
        map.setView(propLatLng, finalZoom, { animate: false });
      }
    }
    // Wait for tiles to render at final position
    await new Promise((r) => setTimeout(r, 2000));

    // Force SmartClusterLayer to re-render at the export-sized map dimensions
    // so connector positions are recalculated correctly for the new viewport.
    // Uses custom 'exportrender' event to preserve user's manual drag overrides
    // (unlike zoomend which would clear them).
    if (map) {
      map.fire('exportrender');
    }
    await new Promise((r) => setTimeout(r, 500)); // wait for render to complete

    const fixed = fixObjectFitForExport(panel);
    try {
      // ── Single capture — connectors render directly via Leaflet SVG ──
      const bgColor = mapStyle === 'satellite' ? '#1a2e1a' : '#f2efe9';

      // ── Measure property label and pin SEPARATELY for independent re-stamping ──
      // Each element gets its own tight bounding box so connector lines can
      // pass between the label and pin (no single merged rectangle covering the gap).
      const propElementBoxes = []; // array of {left,top,right,bottom} in container coords
      if (data) {
        const panelRect = panel.getBoundingClientRect();
        const propLabelEl = panel.querySelector('.property-label');
        const propPinEl = panel.querySelector('.property-pin');
        [propLabelEl, propPinEl].filter(Boolean).forEach((el) => {
          const r = el.getBoundingClientRect();
          propElementBoxes.push({
            left:   r.left - panelRect.left,
            top:    r.top - panelRect.top,
            right:  r.right - panelRect.left,
            bottom: r.bottom - panelRect.top,
          });
        });
      }

      // ── Hide ALL connector/vector layers before capture ──
      // We redraw radius ring + connectors on canvas with correct coordinates.
      // Must hide: (1) the connectorPane (Leaflet polylines + dots),
      // (2) ALL overlay SVGs (radius ring, any other vectors),
      // (3) any Canvas renderer elements.
      // Connector pane — hide the entire pane div (works for both SVG & Canvas renderers)
      const connectorPane = map ? map.getPane('connectorPane') : null;
      const origConnectorDisplay = connectorPane ? connectorPane.style.display : '';
      if (connectorPane) connectorPane.style.display = 'none';

      // Hide overlay SVGs (radius ring etc.) but preserve marker icon SVGs
      const allSvgs = [...panel.querySelectorAll('svg')];
      const svgsToHide = allSvgs.filter((svg) =>
        !svg.closest('.leaflet-marker-icon') && !svg.closest('.property-marker')
      );
      const origSvgDisplays = [];
      svgsToHide.forEach((svg) => {
        origSvgDisplays.push(svg.style.display);
        svg.style.display = 'none';
      });

      // Also hide any Canvas renderer elements (Leaflet may use canvas for vectors)
      const overlayCanvases = [...panel.querySelectorAll('.leaflet-overlay-pane canvas')];
      const origCanvasDisplays = overlayCanvases.map((c) => c.style.display);
      overlayCanvases.forEach((c) => { c.style.display = 'none'; });

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

      // Restore all hidden elements after capture
      if (connectorPane) connectorPane.style.display = origConnectorDisplay;
      svgsToHide.forEach((svg, i) => {
        svg.style.display = origSvgDisplays[i] || '';
      });
      overlayCanvases.forEach((c, i) => {
        c.style.display = origCanvasDisplays[i] || '';
      });

      // Build output canvas at 300 DPI landscape letter
      const outCanvas = document.createElement('canvas');
      outCanvas.width = EXPORT_W;   // 3300
      outCanvas.height = EXPORT_H;  // 2550
      const ctx = outCanvas.getContext('2d');
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

      // Layer 1: Full capture (tiles + markers)
      ctx.drawImage(rawCanvas, 0, 0, EXPORT_W, EXPORT_H);

      // Layer 1.5: Draw radius ring directly on canvas (avoids SVG offset bug)
      if (map && data) {
        const scaleX = EXPORT_W / CAPTURE_W;
        const scaleY = EXPORT_H / CAPTURE_H;
        const lat = data.property.lat;
        const lng = data.property.lng;
        const propPt = map.latLngToContainerPoint([lat, lng]);
        const radiusMeters = parseFloat(radius) * 1609.34;

        // Calculate pixel radius: offset by radius in degrees latitude (~111,320 m/deg)
        const degOffset = radiusMeters / 111320;
        const northPt = map.latLngToContainerPoint([lat + degOffset, lng]);
        const pxRadius = Math.abs(propPt.y - northPt.y);

        ctx.beginPath();
        ctx.arc(propPt.x * scaleX, propPt.y * scaleY, pxRadius * scaleX, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200, 169, 81, 0.7)';
        ctx.lineWidth = 4 * scaleX;
        ctx.setLineDash([8 * scaleX, 6 * scaleX]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(200, 169, 81, 0.04)';
        ctx.fill();

        // Draw radius label at the bottom of the ring
        const radiusLabel = parseFloat(radius) === 1 ? '1 Mile' : `${radius} Miles`;
        const labelX = propPt.x * scaleX;
        const labelY = (propPt.y + pxRadius) * scaleY + 18 * scaleY;
        const labelFontSize = Math.round(13 * scaleX);
        ctx.font = `600 ${labelFontSize}px "Gotham", "Montserrat", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        // Background pill behind text
        const metrics = ctx.measureText(radiusLabel);
        const pillW = metrics.width + 16 * scaleX;
        const pillH = labelFontSize + 10 * scaleX;
        ctx.fillStyle = 'rgba(200, 169, 81, 0.85)';
        const pillR = pillH / 2;
        ctx.beginPath();
        ctx.roundRect(labelX - pillW / 2, labelY - 3 * scaleX, pillW, pillH, pillR);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(radiusLabel, labelX, labelY);
      }

      // Layer 2: Draw connector lines from displaced logo markers to actual positions.
      // Lines are drawn in full (no clipping). The property marker is then drawn
      // on top using canvas primitives (not a rectangular re-stamp) so lines
      // naturally pass behind the label + pin with no visible buffer zone.
      if (map && data && connectorDataRef.current && connectorDataRef.current.length > 0) {
        const scaleX = EXPORT_W / CAPTURE_W;
        const scaleY = EXPORT_H / CAPTURE_H;
        const rawScaleX = rawCanvas.width / CAPTURE_W;
        const rawScaleY = rawCanvas.height / CAPTURE_H;

        const connectors = connectorDataRef.current.map((c) => {
          const fromPt = map.latLngToContainerPoint(c.from);
          const toPt = map.latLngToContainerPoint(c.to);
          const iconW = c.iconW || 46;
          const iconH = c.iconH || 46;
          const padW = c.padW || iconW + MARKER_PAD;
          const padH = c.padH || iconH + MARKER_PAD;
          const dist = Math.hypot(fromPt.x - toPt.x, fromPt.y - toPt.y);
          return {
            fromX: fromPt.x,
            fromY: fromPt.y + iconH / 2,
            toX: toPt.x,
            toY: toPt.y,
            markerCx: fromPt.x,
            markerCy: fromPt.y,
            markerW: padW,
            markerH: padH,
            dist,
          };
        }).filter((c) => c.dist > 5);

        // Pass 1: Draw connector lines in full (no clipping)
        connectors.forEach(({ fromX, fromY, toX, toY }) => {
          const x1 = fromX * scaleX, y1 = fromY * scaleY;
          const x2 = toX * scaleX, y2 = toY * scaleY;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.lineWidth = 8 * scaleX;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4 * scaleX;
          ctx.stroke();

          // White dot at actual retailer location
          ctx.beginPath();
          ctx.arc(x2, y2, 7 * scaleX, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x2, y2, 5 * scaleX, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        });

        // Pass 2: Re-stamp retailer logo marker regions from rawCanvas
        const EDGE_INSET = 3;
        connectors.forEach(({ markerCx, markerCy, markerW, markerH }) => {
          const boxX = markerCx - markerW / 2 + EDGE_INSET;
          const boxY = markerCy - markerH / 2 + EDGE_INSET;
          const boxW = markerW - EDGE_INSET * 2;
          const boxH = markerH - EDGE_INSET * 2;
          const srcX = boxX * rawScaleX;
          const srcY = boxY * rawScaleY;
          const srcW = boxW * rawScaleX;
          const srcH = boxH * rawScaleY;
          if (srcX >= 0 && srcY >= 0 && srcW > 0 && srcH > 0 &&
              srcX + srcW <= rawCanvas.width && srcY + srcH <= rawCanvas.height) {
            ctx.drawImage(rawCanvas, srcX, srcY, srcW, srcH,
              boxX * scaleX, boxY * scaleY, boxW * scaleX, boxH * scaleY);
          }
        });

        // Pass 3: Re-stamp property label and pin INDEPENDENTLY from rawCanvas.
        // Each element gets its own tight re-stamp so connector lines can pass
        // through the gap between them — no single merged rectangle.
        propElementBoxes.forEach((box) => {
          const pX = box.left;
          const pY = box.top;
          const pW = box.right - box.left;
          const pH = box.bottom - box.top;
          const pSrcX = pX * rawScaleX;
          const pSrcY = pY * rawScaleY;
          const pSrcW = pW * rawScaleX;
          const pSrcH = pH * rawScaleY;
          if (pSrcX >= 0 && pSrcY >= 0 && pSrcW > 0 && pSrcH > 0 &&
              pSrcX + pSrcW <= rawCanvas.width && pSrcY + pSrcH <= rawCanvas.height) {
            ctx.drawImage(rawCanvas, pSrcX, pSrcY, pSrcW, pSrcH,
              pX * scaleX, pY * scaleY, pW * scaleX, pH * scaleY);
          }
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
  }, [data, mapStyle, filteredRetailers]);

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

          {/* Radius ring */}
          {data && (
            <Circle
              center={[data.property.lat, data.property.lng]}
              radius={parseFloat(radius) * 1609.34}
              pathOptions={{
                color: '#c8a951',
                weight: 4,
                opacity: 0.7,
                fillColor: '#c8a951',
                fillOpacity: 0.04,
                dashArray: '8, 6',
              }}
            />
          )}

          {/* Subject property marker (highest z-index) */}
          {data && (
            <Marker
              position={[data.property.lat, data.property.lng]}
              icon={createPropertyIcon(getStreetAddress(data.property.display))}
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
            radiusMiles={parseFloat(radius)}
          >
            {data?.retailers.map((r, i) => {
              if (!filteredRetailers.includes(r)) return null;
              const cfg = getCategoryConfig(r.category);
              const logoUrl = getLogoUrl(r.name);
              return {
                position: [r.lat, r.lng],
                icon: logoUrl ? createLogoIcon(logoUrl, r.name) : createRetailerIcon(r.category),
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
