import { useRef, useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getLogoUrl, getFallbackLogoUrl, createLogoIcon, getLogoMarkerW, LOGO_H, LOGO_MIN_W } from './logos.js';

// ── Category config (shared) ─────────────────────────────────────
export const CATEGORIES = {
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

export function getCategoryConfig(category) {
  if (CATEGORIES[category]) return CATEGORIES[category];
  for (const key of Object.keys(CATEGORIES)) {
    if (category?.toLowerCase().includes(key.toLowerCase())) return CATEGORIES[key];
  }
  return CATEGORIES.Other;
}

export function createRetailerIcon(category) {
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

// ── Smart Clustering + Collision-Avoidance System ────────────────
// Groups overlapping markers into clusters, then displaces clusters/singles
// so the subject property is never blocked and the map stays clean.

export const MARKER_PAD = 14;         // generous breathing room between individual logos
export const CLUSTER_CELL = 52;       // px per logo cell inside cluster grid
export const CLUSTER_GAP = 5;         // px gap between cells
export const CLUSTER_PAD = 8;         // px padding inside cluster border
export const MAX_CLUSTER_COLS = 3;    // max columns in cluster grid
export const MAX_CLUSTER_SIZE = 6;    // max items per cluster (split larger ones)

// Zoom-adaptive extra padding for merge detection:
// At low zoom we pad more so distant markers merge sooner
export function getClusterPadding(zoom) {
  if (zoom >= 16) return 2;    // tight: only merge if truly overlapping
  if (zoom >= 14) return 6;    // reduced from 10
  if (zoom >= 12) return 12;   // reduced from 18
  return 20;                    // reduced from 28
}

// SVG renderer for connecting lines (html2canvas captures SVG DOM elements reliably)
// Connector pane — created lazily, sits below markers
export function ensureConnectorPane(map) {
  if (!map.getPane('connectorPane')) {
    const pane = map.createPane('connectorPane');
    pane.style.zIndex = '350'; // Below overlayPane (400) and markerPane (600)
  }
}

// ── Step 1: Group nearby markers into clusters (pixel space) ─────
export function buildClusters(map, items) {
  const zoom = map.getZoom();
  const pad = getClusterPadding(zoom);
  // Auto-enable clustering when retailer count is high (dense corridors)
  // Fewer than 16 retailers: all individual. 16+: cluster groups of 2+.
  const MIN_CLUSTER_SIZE = items.length >= 16 ? 2 : 999;

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

  // Merge nodes whose actual positions are close together.
  // For dense areas (16+ items), use a wider proximity threshold to
  // aggressively cluster and reduce connector line clutter.
  const proximityPad = items.length >= 16 ? pad + 40 : pad;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const ni = nodes[i], nj = nodes[j];
      const overlapX = (ni.w + nj.w) / 2 + proximityPad - Math.abs(ni.px - nj.px);
      const overlapY = (ni.h + nj.h) / 2 + proximityPad - Math.abs(ni.py - nj.py);
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

    // Multi-marker cluster — uniform grid dimensions
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

// ── Step 2: Create a cluster divIcon showing a uniform logo grid ────
// All cells are equal size. Failed logos fall back to brand name text.
export function createClusterGridIcon(cluster, childrenData) {
  const { items, cols, gridW, gridH } = cluster;
  const cells = items.map((item) => {
    const child = childrenData.find((c) => c && c.idx === item.idx);
    if (!child) return '<div class="sc-cell"></div>';
    const logoUrl = child.logoUrl;
    const name = (child.name || '').replace(/'/g, "\\'");
    const shortName = name.length > 10 ? name.substring(0, 9) + '\u2026' : name;
    if (logoUrl) {
      const cellFb = child.name ? getFallbackLogoUrl(child.name) : null;
      // On error: try BrandFetch fallback, then show brand name text
      const fallbackHtml = `<span class=&quot;sc-fallback&quot;>${shortName}</span>`;
      const cellErr = cellFb
        ? `this.onerror=function(){this.parentElement.innerHTML='${fallbackHtml}'};this.src='${cellFb}'`
        : `this.onerror=null;this.parentElement.innerHTML='${fallbackHtml}'`;
      return `<div class="sc-cell"><img src="${logoUrl}" alt="" width="44" height="44" style="object-fit:contain;" onerror="${cellErr}" /></div>`;
    }
    return `<div class="sc-cell"><span class="sc-fallback">${shortName}</span></div>`;
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

// Test if a line segment (x1,y1)→(x2,y2) intersects an axis-aligned rect
function lineIntersectsRect(x1, y1, x2, y2, left, top, right, bottom) {
  // Liang-Barsky algorithm
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - left, right - x1, y1 - top, bottom - y1];
  let tMin = 0, tMax = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-10) {
      if (q[i] < 0) return false; // parallel and outside
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > tMin) tMin = t; }
      else { if (t < tMax) tMax = t; }
      if (tMin > tMax) return false;
    }
  }
  return true;
}

// Push two rects apart symmetrically (both move half the distance)
function pushBothApart(a, b) {
  let dx = a.x - b.x;
  let dy = a.y - b.y;
  const GAP = 36; // generous gap so connector lines between logos stay visible
  const overlapX = (a.w + b.w) / 2 + GAP - Math.abs(dx);
  const overlapY = (a.h + b.h) / 2 + GAP - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return false;

  if (overlapX < overlapY) {
    const push = Math.sign(dx || 1) * (overlapX / 2 + 2);
    a.x += push;
    b.x -= push;
  } else {
    const push = Math.sign(dy || 1) * (overlapY / 2 + 2);
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

export function displaceClusterRects(map, clusters, propertyLatLng, radiusMiles) {
  const mapSize = map.getSize();
  const propPt = map.latLngToContainerPoint(propertyLatLng);
  const MARGIN_X = 20;  // px from left/right edge
  const MARGIN_Y = 30;  // px from top/bottom edge
  const GAP_Y = 10;     // vertical gap between logos in a column

  // Compute radius ring position in pixels for column placement
  const radiusMeters = (radiusMiles || 1) * 1609.34;
  const degLat = radiusMeters / 111320;
  const degLng = radiusMeters / (111320 * Math.cos(propertyLatLng.lat * Math.PI / 180));
  const ringLeftPt = map.latLngToContainerPoint([propertyLatLng.lat, propertyLatLng.lng - degLng]);
  const ringRightPt = map.latLngToContainerPoint([propertyLatLng.lat, propertyLatLng.lng + degLng]);
  const ringLeft = ringLeftPt.x;
  const ringRight = ringRightPt.x;

  // Split clusters into left/right based on actual position relative to property
  const leftItems = [];
  const rightItems = [];
  clusters.forEach((c, i) => {
    if (c.cx <= propPt.x) {
      leftItems.push({ ...c, idx: i });
    } else {
      rightItems.push({ ...c, idx: i });
    }
  });

  // Balance: if one side has way more, move some to the other
  while (leftItems.length > rightItems.length + 2) {
    rightItems.push(leftItems.pop());
  }
  while (rightItems.length > leftItems.length + 2) {
    leftItems.push(rightItems.pop());
  }

  // Sort each column by angle from property center.
  // This fans connector lines out naturally without crossing.
  // Left column: sort by angle so top items point upper-left, bottom items lower-left
  // Right column: same but mirrored
  function angleFromProp(c) {
    return Math.atan2(c.cy - propPt.y, c.cx - propPt.x);
  }
  leftItems.sort((a, b) => angleFromProp(a) - angleFromProp(b));
  rightItems.sort((a, b) => angleFromProp(a) - angleFromProp(b));

  // Compute column positions
  // Left column: right-aligned to just outside the ring (or at left margin if ring is far right)
  // Right column: left-aligned to just outside the ring
  const RING_GAP = 30; // gap between ring edge and logo column
  const leftColRight = Math.min(ringLeft - RING_GAP, mapSize.x * 0.4);
  const rightColLeft = Math.max(ringRight + RING_GAP, mapSize.x * 0.6);

  // Layout function: evenly distribute items vertically, aligned to column edge
  function layoutColumn(items, colEdgeX, alignRight) {
    if (items.length === 0) return [];
    const totalH = items.reduce((sum, c) => sum + c.h, 0) + (items.length - 1) * GAP_Y;
    // Center the column vertically in the usable area
    const usableTop = MARGIN_Y;
    const usableBottom = mapSize.y - MARGIN_Y;
    const usableH = usableBottom - usableTop;
    let startY = usableTop + Math.max(0, (usableH - totalH) / 2);

    // If items don't fit, compress the gap
    let effectiveGap = GAP_Y;
    if (totalH > usableH) {
      const totalItemH = items.reduce((sum, c) => sum + c.h, 0);
      effectiveGap = Math.max(2, (usableH - totalItemH) / Math.max(1, items.length - 1));
      startY = usableTop;
    }

    return items.map((c) => {
      const y = startY + c.h / 2;
      // Align: right-align for left column, left-align for right column
      const x = alignRight
        ? Math.max(MARGIN_X + c.w / 2, colEdgeX - c.w / 2)
        : Math.min(mapSize.x - MARGIN_X - c.w / 2, colEdgeX + c.w / 2);
      startY += c.h + effectiveGap;
      return { idx: c.idx, x, y, origX: c.cx, origY: c.cy };
    });
  }

  const leftPositions = layoutColumn(leftItems, leftColRight, true);
  const rightPositions = layoutColumn(rightItems, rightColLeft, false);
  const allPositions = [...leftPositions, ...rightPositions];

  // Build result indexed by cluster idx
  const result = clusters.map((c, i) => {
    const pos = allPositions.find((p) => p.idx === i);
    if (!pos) {
      return { idx: i, displacedLatLng: [propertyLatLng.lat, propertyLatLng.lng], wasDisplaced: false };
    }
    const displacedLL = map.containerPointToLatLng([pos.x, pos.y]);
    const dist = Math.hypot(pos.x - pos.origX, pos.y - pos.origY);
    return {
      idx: i,
      displacedLatLng: [displacedLL.lat, displacedLL.lng],
      wasDisplaced: dist > 1,
    };
  });

  return result;
}

// ── Step 4: SmartClusterLayer component ──────────────────────────
export function SmartClusterLayer({ children, onMarkerClick, markerRefs, propertyLatLng, connectorDataRef, isExportingRef, radiusMiles }) {
  const map = useMap();
  const layerGroupRef = useRef(null);
  const linesGroupRef = useRef(null);
  // Store user drag overrides: key → [lat, lng]
  // Key is "s-{idx}" for singles, "c-{sorted idx list}" for clusters
  const dragOverrides = useRef({});
  // Track whether a drag just finished to suppress the moveend re-render
  const justDragged = useRef(false);

  useEffect(() => {
    // Ensure connector pane exists (below markers)
    ensureConnectorPane(map);
    const lines = L.layerGroup({ pane: 'connectorPane' }).addTo(map);
    const layers = L.layerGroup().addTo(map);
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

      // O(1) lookup map for children by idx
      const childByIdx = new Map(children.filter(Boolean).map((c) => [c.idx, c]));

      // Build item list
      const items = children.map((child) => ({
        position: L.latLng(child.position[0], child.position[1]),
        markerW: child.icon?.options?.iconSize?.[0] || LOGO_MIN_W,
        idx: child.idx,
      }));

      // Step 1: Build clusters
      const clusters = buildClusters(map, items);

      // Step 2: Displace clusters to avoid subject property + each other
      const displaced = displaceClusterRects(map, clusters, propLL, radiusMiles);

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
        const isDisplaced = !!overridePos || dist > 1;

        if (cluster.type === 'single') {
          const item = cluster.items[0];
          const child = childByIdx.get(item.idx);
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
          let icon;
          try {
            icon = createClusterGridIcon(cluster, children);
          } catch (err) {
            console.error('Cluster icon error:', err, cluster);
            // Fallback to simple icon
            icon = L.divIcon({ html: `<div style="background:white;padding:4px;border-radius:4px;">${cluster.items.length} retailers</div>`, className: '', iconSize: [100, 30] });
          }
          const marker = L.marker(markerLatLng, { icon, draggable: true });

          const names = cluster.items.map((item) => {
            return childByIdx.get(item.idx)?.name || '';
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

        // Draw connector line from logo to actual map location
        if (isDisplaced) {
          // Store data for canvas-based export drawing
          // iconW/iconH = visible logo size (without MARKER_PAD collision buffer)
          // padW/padH = full bounding box including MARKER_PAD (for re-stamping)
          connectors.push({
            from: Array.isArray(markerLatLng) ? markerLatLng : [markerLatLng.lat, markerLatLng.lng],
            to: cluster.centroidLatLng,
            iconW: cluster.w - MARKER_PAD,
            iconH: cluster.h - MARKER_PAD,
            padW: cluster.w,
            padH: cluster.h,
          });

          // Connector line — white with dark outline for visibility
          const shadow = L.polyline(
            [markerLatLng, cluster.centroidLatLng],
            {
              weight: 8,
              color: '#000000',
              opacity: 0.3,
              interactive: false,
              pane: 'connectorPane',
            }
          );
          lines.addLayer(shadow);
          const line = L.polyline(
            [markerLatLng, cluster.centroidLatLng],
            {
              weight: 4,
              color: '#ffffff',
              opacity: 1,
              interactive: false,
              pane: 'connectorPane',
            }
          );
          lines.addLayer(line);

          // White dot with dark outline at actual location
          const dotShadow = L.circleMarker(cluster.centroidLatLng, {
            radius: 7,
            fillColor: '#000000',
            fillOpacity: 0.3,
            stroke: false,
            interactive: false,
            pane: 'connectorPane',
          });
          lines.addLayer(dotShadow);
          const dot = L.circleMarker(cluster.centroidLatLng, {
            radius: 5,
            fillColor: '#ffffff',
            fillOpacity: 1,
            stroke: false,
            interactive: false,
            pane: 'connectorPane',
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

    // Export-safe re-render: recalculates positions preserving drag overrides
    const onExportRender = () => {
      render();
    };

    map.on('zoomend', onZoom);
    map.on('moveend', debouncedRender);
    map.on('exportrender', onExportRender);

    return () => {
      if (timer) clearTimeout(timer);
      map.off('zoomend', onZoom);
      map.off('moveend', debouncedRender);
      map.off('exportrender', onExportRender);
    };
  }, [children, onMarkerClick, markerRefs, propertyLatLng, radiusMiles, map]);

  return null;
}
