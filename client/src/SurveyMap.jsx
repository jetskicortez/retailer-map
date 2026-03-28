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
import { createRecommendedIcon, createNumberedIcon } from './surveyMarkers.js';
import { getLogoUrl, preloadLogo, createLogoIcon } from './logos.js';
import { getCategoryConfig, createRetailerIcon, SmartClusterLayer } from './clustering.js';

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

// ── Map helpers ──────────────────────────────────────────────────────
function MapController({ flyTo, fitBounds }) {
  const map = useMap();
  useEffect(() => {
    if (fitBounds && fitBounds.length > 0) {
      map.fitBounds(fitBounds, { padding: [60, 60], maxZoom: 14 });
    }
  }, [fitBounds, map]);
  useEffect(() => {
    if (flyTo) {
      map.flyTo(flyTo, 15, { duration: 0.8 });
    }
  }, [flyTo, map]);
  return null;
}

function SurveyTileLayer({ style }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current);

    const url = style === 'satellite'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

    const attr = style === 'satellite'
      ? 'Tiles &copy; Esri'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>';

    layerRef.current = L.tileLayer(url, { attribution: attr, maxZoom: 19 }).addTo(map);

    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [style, map]);

  return null;
}

// ── Decode hash data ─────────────────────────────────────────────────
function decodeHashData() {
  try {
    const hash = window.location.hash;
    if (!hash || !hash.includes('data=')) return null;
    const b64 = hash.split('data=')[1];
    const json = atob(b64);
    return JSON.parse(json);
  } catch (err) {
    console.error('Failed to decode survey data from URL hash:', err);
    return null;
  }
}

// ── Input Form (shown when no hash data) ─────────────────────────────
function SurveyForm({ onSubmit }) {
  const [title, setTitle] = useState('');
  const [textInput, setTextInput] = useState('');
  const [parseError, setParseError] = useState('');

  const placeholder = `Paste properties — one per line:
Property Name | Address | SF | Asking Rent | Notes

Example:
Etna Towne Centre | 550 Butler St, Etna, PA 15223 | 3,344 | Withheld | Newest build, flex-friendly
Jane Street Commons | 2300 Jane St, Pittsburgh, PA 15203 | 4,800 | $1.13/SF | Renovated center

Or paste JSON:
[{"name":"...","address":"...","sf":"...","askingRent":"..."}]`;

  const handleSubmit = () => {
    setParseError('');
    const text = textInput.trim();
    if (!text) { setParseError('Paste property data above.'); return; }

    let properties = [];

    // Try JSON first
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        properties = parsed;
      } else if (parsed.properties) {
        properties = parsed.properties;
        if (parsed.title && !title) setTitle(parsed.title);
      }
    } catch {
      // Parse pipe-delimited lines
      const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('Property Name'));
      for (const line of lines) {
        const parts = line.split('|').map(s => s.trim());
        if (parts.length >= 2) {
          properties.push({
            name: parts[0] || '',
            address: parts[1] || '',
            sf: parts[2] || '',
            askingRent: parts[3] || '',
            notes: parts[4] || '',
          });
        }
      }
    }

    if (properties.length === 0) {
      setParseError('Could not parse any properties. Use pipe-delimited lines or JSON.');
      return;
    }

    // Auto-rank: first 4 are recommended
    properties = properties.map((p, i) => ({
      ...p,
      rank: p.rank || i + 1,
      recommended: p.recommended ?? (i < 4),
    }));

    onSubmit({ title: title || 'Market Survey', properties });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="survey-form-container">
      <div className="survey-form">
        <h1 className="survey-form-title">Market Survey Map</h1>
        <p className="survey-form-desc">Plot candidate properties on a map with optional retailer overlay.</p>

        <label className="survey-form-label">Survey Title</label>
        <input
          type="text"
          className="survey-form-input"
          placeholder="e.g. Office Search — Harvie LLC"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <label className="survey-form-label">Properties</label>
        <textarea
          className="survey-form-textarea"
          rows={12}
          placeholder={placeholder}
          value={textInput}
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <p className="survey-form-shortcut">Ctrl+Enter to generate</p>

        {parseError && <p className="survey-form-error">{parseError}</p>}

        <button className="survey-form-btn" onClick={handleSubmit}>
          Generate Survey Map
        </button>

        <p className="survey-form-hint">
          First 4 properties are marked as recommended (green star). Others get numbered pins.
        </p>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────
export default function SurveyMap() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialStyle = urlParams.get('style') || 'street';

  // Core state
  const [surveyTitle, setSurveyTitle] = useState('Market Survey');
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [activePropertyIdx, setActivePropertyIdx] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [fitBounds, setFitBounds] = useState(null);

  // Retailer state
  const [retailers, setRetailers] = useState([]);
  const [showRetailers, setShowRetailers] = useState(false);
  const [retailersLoading, setRetailersLoading] = useState(false);
  const [activeCategories, setActiveCategories] = useState(new Set());
  const [activeChainSizes, setActiveChainSizes] = useState(new Set());
  const [retailerAccordionOpen, setRetailerAccordionOpen] = useState(false);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mapStyle, setMapStyle] = useState(initialStyle);

  // Drive-time overlay state: null = off, 5/15/30 = minutes
  const [driveTimeMinutes, setDriveTimeMinutes] = useState(null);

  const mapRef = useRef(null);
  const mapPanelRef = useRef(null);
  const cardRefs = useRef({});
  const connectorDataRef = useRef([]);
  const isExportingRef = useRef(false);

  // ── Handle form submission ─────────────────────────────────────────
  const handleFormSubmit = useCallback(async (data) => {
    setShowForm(false);
    setLoading(true);
    setLoadingStatus(`Geocoding ${data.properties.length} properties\u2026`);
    setSurveyTitle(data.title);

    try {
      const addresses = data.properties.map(p => p.address);
      const geoRes = await fetch('/api/geocode-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses }),
      });

      if (!geoRes.ok) throw new Error('Geocoding failed');
      const geoResults = await geoRes.json();

      const enriched = data.properties.map((p, i) => ({
        ...p,
        lat: geoResults[i]?.lat || null,
        lng: geoResults[i]?.lng || null,
        geocoded: !!(geoResults[i]?.lat),
      }));

      const valid = enriched.filter(p => p.geocoded);
      if (valid.length === 0) throw new Error('Could not geocode any property addresses.');

      // Fetch nearest highway on-ramp for each property
      setLoadingStatus('Finding nearest highway access\u2026');
      try {
        const hwRes = await fetch('/api/nearest-highway', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            properties: valid.map(p => ({ lat: p.lat, lng: p.lng, name: p.name })),
          }),
        });
        if (hwRes.ok) {
          const hwResults = await hwRes.json();
          let hwIdx = 0;
          for (let i = 0; i < enriched.length; i++) {
            if (enriched[i].geocoded) {
              enriched[i].nearestHighway = hwResults[hwIdx] || null;
              hwIdx++;
            }
          }
        }
      } catch {
        // Highway data is non-critical — continue without it
      }

      setProperties(enriched);
      setFitBounds(valid.map(p => [p.lat, p.lng]));

      // Update URL hash so this map is shareable
      const sharePayload = {
        title: data.title,
        properties: data.properties.map(({ _raw, ...rest }) => rest),
      };
      const b64 = btoa(JSON.stringify(sharePayload));
      window.history.replaceState(null, '', `${window.location.pathname}?mode=survey#data=${b64}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load survey data on mount (from hash if present) ───────────────
  useEffect(() => {
    const data = decodeHashData();
    if (!data || !data.properties?.length) {
      setShowForm(true);
      return;
    }
    // Hash data found — load it via the same path as form submission
    handleFormSubmit(data);
  }, [handleFormSubmit]);

  // ── Load retailers when toggled on ───────────────────────────────
  useEffect(() => {
    if (!showRetailers || retailers.length > 0) return;

    const validProps = properties.filter(p => p.geocoded);
    if (validProps.length === 0) return;

    async function fetchRetailers() {
      setRetailersLoading(true);

      // Compute centroid
      const centroid = {
        lat: validProps.reduce((s, p) => s + p.lat, 0) / validProps.length,
        lng: validProps.reduce((s, p) => s + p.lng, 0) / validProps.length,
      };

      // Compute radius: max distance from centroid to any property + 1 mile buffer
      let maxDist = 0;
      for (const p of validProps) {
        const d = haversine(centroid.lat, centroid.lng, p.lat, p.lng);
        if (d > maxDist) maxDist = d;
      }
      const searchRadius = Math.min(Math.max(Math.ceil(maxDist + 1), 1), 5);

      try {
        const res = await fetch('/api/places-nearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: centroid.lat,
            lng: centroid.lng,
            radiusMiles: searchRadius,
            propertyAddress: 'Survey Centroid',
          }),
        });

        if (!res.ok) throw new Error('Retailer search failed');
        const data = await res.json();
        setRetailers(data.retailers || []);

        // Preload retailer logos
        const logoUrls = (data.retailers || []).map(r => getLogoUrl(r.name)).filter(Boolean);
        await Promise.all(logoUrls.map(preloadLogo));
      } catch (err) {
        console.error('Retailer fetch error:', err);
      } finally {
        setRetailersLoading(false);
      }
    }

    fetchRetailers();
  }, [showRetailers, properties, retailers.length]);

  // ── Filtered retailers ───────────────────────────────────────────
  const filteredRetailers = useMemo(() => {
    if (!showRetailers || retailers.length === 0) return [];
    return retailers.filter((r) => {
      if (activeCategories.size > 0 && !activeCategories.has(r.category)) return false;
      if (activeChainSizes.size > 0 && !activeChainSizes.has(r.chainSize || 'Regional/Local')) return false;
      return true;
    });
  }, [retailers, activeCategories, activeChainSizes, showRetailers]);

  const availableCategories = useMemo(() => {
    if (retailers.length === 0) return [];
    const cats = [...new Set(retailers.map(r => r.category))];
    cats.sort();
    return cats;
  }, [retailers]);

  // ── Toggle helpers ───────────────────────────────────────────────
  const toggleCategory = useCallback((cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const toggleChainSize = useCallback((size) => {
    setActiveChainSizes(prev => {
      const next = new Set(prev);
      if (next.has(size)) next.delete(size);
      else next.add(size);
      return next;
    });
  }, []);

  // ── Property marker creation ─────────────────────────────────────
  const getPropertyIcon = useCallback((prop, index) => {
    const displayName = prop.name || prop.address?.split(',')[0] || `Property ${index + 1}`;
    if (prop.recommended && prop.rank && prop.rank <= 4) {
      return createRecommendedIcon(prop.rank, displayName);
    }
    return createNumberedIcon(index + 1, displayName);
  }, []);

  // ── Export functions ─────────────────────────────────────────────
  const captureMapWithConnectors = useCallback(async () => {
    if (!mapPanelRef.current) return null;
    const map = mapRef.current;

    isExportingRef.current = true;

    // Capture the base map
    const rawCanvas = await html2canvas(mapPanelRef.current, {
      useCORS: true,
      allowTaint: true,
      scale: 2,
      backgroundColor: '#f2efe9',
      width: mapPanelRef.current.offsetWidth,
      height: mapPanelRef.current.offsetHeight,
    });

    // Draw connector lines onto the canvas
    const canvas = document.createElement('canvas');
    canvas.width = rawCanvas.width;
    canvas.height = rawCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(rawCanvas, 0, 0);

    if (map && connectorDataRef.current && connectorDataRef.current.length > 0) {
      const scaleX = rawCanvas.width / mapPanelRef.current.offsetWidth;
      const scaleY = rawCanvas.height / mapPanelRef.current.offsetHeight;

      const connectors = connectorDataRef.current.map((c) => {
        const fromPt = map.latLngToContainerPoint(c.from);
        const toPt = map.latLngToContainerPoint(c.to);
        const dist = Math.hypot(fromPt.x - toPt.x, fromPt.y - toPt.y);
        return {
          fromX: fromPt.x, fromY: fromPt.y + (c.iconH || 46) / 2,
          toX: toPt.x, toY: toPt.y,
          markerCx: fromPt.x, markerCy: fromPt.y,
          markerW: (c.padW || (c.iconW || 46) + 14),
          markerH: (c.padH || (c.iconH || 46) + 14),
          dist,
        };
      }).filter((c) => c.dist > 5);

      // Draw lines
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

        // White dot at actual location
        ctx.beginPath();
        ctx.arc(x2, y2, 7 * scaleX, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x2, y2, 5 * scaleX, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      });

      // Re-stamp marker regions from rawCanvas so logos sit on top of lines
      connectors.forEach(({ markerCx, markerCy, markerW, markerH }) => {
        const boxX = (markerCx - markerW / 2 + 3) * scaleX;
        const boxY = (markerCy - markerH / 2 + 3) * scaleY;
        const boxW = (markerW - 6) * scaleX;
        const boxH = (markerH - 6) * scaleY;
        if (boxX >= 0 && boxY >= 0 && boxW > 0 && boxH > 0 &&
            boxX + boxW <= rawCanvas.width && boxY + boxH <= rawCanvas.height) {
          ctx.drawImage(rawCanvas, boxX, boxY, boxW, boxH, boxX, boxY, boxW, boxH);
        }
      });
    }

    isExportingRef.current = false;
    return canvas;
  }, [surveyTitle]);

  const handleExportPNG = useCallback(async () => {
    try {
      const canvas = await captureMapWithConnectors();
      if (!canvas) return;

      const slug = surveyTitle.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 40) || 'survey_map';
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = `${slug}_map.png`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('Export error:', err);
    }
  }, [surveyTitle, captureMapWithConnectors]);

  const handleExportPDF = useCallback(async () => {
    try {
      const canvas = await captureMapWithConnectors();
      if (!canvas) return;

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH);

      const slug = surveyTitle.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 40) || 'survey_map';
      pdf.save(`${slug}_map.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
    }
  }, [surveyTitle, captureMapWithConnectors]);

  const handleExportCSV = useCallback(() => {
    const lines = ['Rank,Name,Address,SF,Asking Rent/Price,Recommended,Lat,Lng'];
    properties.forEach((p, i) => {
      lines.push(
        `${p.rank || i + 1},"${p.name || ''}","${p.address || ''}","${p.sf || ''}","${p.askingRent || p.askingPrice || ''}",${p.recommended ? 'Yes' : 'No'},${p.lat || ''},${p.lng || ''}`
      );
    });
    if (filteredRetailers.length > 0) {
      lines.push('');
      lines.push('Retailer,Category,Address,Lat,Lng,Distance from Centroid');
      filteredRetailers.forEach(r => {
        lines.push(`"${r.name}","${r.category}","${r.address}",${r.lat},${r.lng},${r.distance_miles}`);
      });
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = surveyTitle.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 40) || 'survey_map';
    a.href = url;
    a.download = `${slug}_properties.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [surveyTitle, properties, filteredRetailers]);

  // ── Click handlers ───────────────────────────────────────────────
  const handlePropertyClick = useCallback((idx) => {
    setActivePropertyIdx(idx);
    const p = properties[idx];
    if (p?.lat && p?.lng) {
      setFlyTo([p.lat, p.lng]);
    }
  }, [properties]);

  // ── Valid properties (geocoded) ──────────────────────────────────
  const validProperties = useMemo(
    () => properties.filter(p => p.geocoded),
    [properties]
  );

  // ── Render ───────────────────────────────────────────────────────
  if (showForm) {
    return <SurveyForm onSubmit={handleFormSubmit} />;
  }

  if (loading) {
    return (
      <div className="survey-loading">
        <div className="survey-loading-spinner" />
        <p>{loadingStatus}</p>
      </div>
    );
  }

  if (error && properties.length === 0) {
    return (
      <div className="survey-loading">
        <p className="survey-error">{error}</p>
      </div>
    );
  }

  const center = validProperties.length > 0
    ? [
        validProperties.reduce((s, p) => s + p.lat, 0) / validProperties.length,
        validProperties.reduce((s, p) => s + p.lng, 0) / validProperties.length,
      ]
    : [40.44, -79.99]; // Pittsburgh default

  return (
    <div className="app">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ' collapsed'}`}>
        <div className="sidebar-header">
          <div>
            <h2 className="survey-title">{surveyTitle}</h2>
            <p className="survey-subtitle">
              {validProperties.length} propert{validProperties.length === 1 ? 'y' : 'ies'}
              {properties.length !== validProperties.length && (
                <span className="survey-warn"> ({properties.length - validProperties.length} could not be geocoded)</span>
              )}
            </p>
          </div>
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? '\u276E' : '\u276F'}
          </button>
        </div>

        {sidebarOpen && (
          <>
            {/* Property list */}
            <div className="survey-property-list">
              {properties.map((p, i) => {
                const isRec = p.recommended && p.rank <= 4;
                const isActive = activePropertyIdx === i;
                return (
                  <div
                    key={i}
                    ref={el => cardRefs.current[i] = el}
                    className={`survey-property-card ${isActive ? 'active' : ''} ${!p.geocoded ? 'failed' : ''}`}
                    onClick={() => p.geocoded && handlePropertyClick(i)}
                  >
                    <div className={`survey-rank-badge ${isRec ? 'recommended' : 'numbered'}`}>
                      {isRec && <span className="survey-star">{'★'}</span>}
                      <span className="survey-rank-num">{p.rank || i + 1}</span>
                    </div>
                    <div className="survey-card-body">
                      <div className="survey-card-name">{p.name || p.address?.split(',')[0]}</div>
                      <div className="survey-card-address">{p.address}</div>
                      <div className="survey-card-details">
                        {p.sf && <span className="survey-detail">{p.sf} SF</span>}
                        {(p.askingRent || p.askingPrice) && (
                          <span className="survey-detail">{p.askingRent || p.askingPrice}</span>
                        )}
                      </div>
                      {p.nearestHighway && (
                        <div className="survey-card-highway">
                          {'\u{1F6E3}\uFE0F'} {p.nearestHighway.distance_miles} mi to {p.nearestHighway.name}{p.nearestHighway.description ? ` (${p.nearestHighway.description})` : ''}
                        </div>
                      )}
                      {p.notes && <div className="survey-card-notes">{p.notes}</div>}
                      {!p.geocoded && <div className="survey-card-error">Could not locate address</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Retailer accordion */}
            <div className="survey-retailer-section">
              <button
                className="survey-accordion-toggle"
                onClick={() => setRetailerAccordionOpen(!retailerAccordionOpen)}
              >
                <span>Nearby Retailers</span>
                <span className="accordion-arrow">{retailerAccordionOpen ? '\u25B2' : '\u25BC'}</span>
              </button>

              {retailerAccordionOpen && (
                <div className="survey-accordion-body">
                  {/* Toggle switch */}
                  <label className="survey-toggle-label">
                    <input
                      type="checkbox"
                      checked={showRetailers}
                      onChange={() => setShowRetailers(!showRetailers)}
                    />
                    <span className="survey-toggle-text">
                      {showRetailers ? 'Retailers visible' : 'Show retailers on map'}
                    </span>
                  </label>

                  {retailersLoading && (
                    <p className="survey-retailer-status">Searching nearby retailers\u2026</p>
                  )}

                  {showRetailers && retailers.length > 0 && (
                    <>
                      <p className="survey-retailer-count">
                        {filteredRetailers.length} of {retailers.length} retailers shown
                      </p>

                      {/* Chain size filters */}
                      <div className="filter-row">
                        {['National', 'Regional/Local'].map(size => (
                          <button
                            key={size}
                            className={`filter-chip chain ${activeChainSizes.has(size) ? 'active' : ''}`}
                            onClick={() => toggleChainSize(size)}
                          >
                            {size}
                          </button>
                        ))}
                      </div>

                      {/* Category filters */}
                      <div className="filter-row">
                        {availableCategories.map(cat => {
                          const cfg = getCategoryConfig(cat);
                          return (
                            <button
                              key={cat}
                              className={`filter-chip ${activeCategories.has(cat) ? 'active' : ''}`}
                              onClick={() => toggleCategory(cat)}
                              style={activeCategories.has(cat) ? { backgroundColor: cfg.color, borderColor: cfg.color } : {}}
                            >
                              {cfg.emoji} {cat}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Drive-time overlay */}
            <div className="survey-drivetime-section">
              <div className="survey-drivetime-label">Drive Time</div>
              <div className="survey-drivetime-btns">
                {[5, 15, 30].map(min => (
                  <button
                    key={min}
                    className={`survey-drivetime-btn ${driveTimeMinutes === min ? 'active' : ''}`}
                    onClick={() => setDriveTimeMinutes(driveTimeMinutes === min ? null : min)}
                  >
                    {min} min
                  </button>
                ))}
              </div>
            </div>

            {/* Map style toggle */}
            <div className="survey-controls">
              <button
                className="survey-style-btn"
                onClick={() => setMapStyle(s => s === 'street' ? 'satellite' : 'street')}
              >
                {mapStyle === 'street' ? '\u{1F6F0}\uFE0F Satellite' : '\u{1F5FA}\uFE0F Street'}
              </button>
            </div>

            {/* Export buttons */}
            <div className="export-section">
              <div className="export-buttons">
                <button onClick={handleExportPNG} className="btn-export primary">Export PNG</button>
                <button onClick={handleExportPDF} className="btn-export">Export PDF</button>
                <button onClick={handleExportCSV} className="btn-export">Export CSV</button>
              </div>
            </div>
          </>
        )}
      </aside>

      {/* ── Map ──────────────────────────────────────────────────── */}
      <div className={`map-panel${mapStyle === 'satellite' ? ' satellite' : ''}`} ref={mapPanelRef}>
        <MapContainer
          center={center}
          zoom={12}
          style={{ width: '100%', height: '100%' }}
          ref={mapRef}
          zoomControl={true}
        >
          <SurveyTileLayer style={mapStyle} />
          <MapController flyTo={flyTo} fitBounds={fitBounds} />

          {/* Drive-time circles */}
          {driveTimeMinutes && validProperties.map((p, i) => {
            // Approximate drive-time radii (miles → meters)
            // Urban Pittsburgh averages: 5min ≈ 1.5mi, 15min ≈ 5mi, 30min ≈ 12mi
            const radiusMap = { 5: 2414, 15: 8047, 30: 19312 };
            const radius = radiusMap[driveTimeMinutes] || 8047;
            const isRec = p.recommended && p.rank <= 4;
            return (
              <Circle
                key={`dt-${i}`}
                center={[p.lat, p.lng]}
                radius={radius}
                pathOptions={{
                  color: isRec ? '#2E7D32' : '#546E7A',
                  fillColor: isRec ? '#2E7D32' : '#546E7A',
                  fillOpacity: 0.08,
                  weight: 1.5,
                  dashArray: '6 4',
                }}
              />
            );
          })}

          {/* Property markers */}
          {validProperties.map((p, i) => {
            const origIdx = properties.indexOf(p);
            return (
              <Marker
                key={`prop-${i}`}
                position={[p.lat, p.lng]}
                icon={getPropertyIcon(p, origIdx)}
                eventHandlers={{
                  click: () => {
                    setActivePropertyIdx(origIdx);
                    if (cardRefs.current[origIdx]) {
                      cardRefs.current[origIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                  },
                }}
              >
                <Popup>
                  <div className="survey-popup">
                    <strong>{p.name || p.address?.split(',')[0]}</strong>
                    <div className="survey-popup-address">{p.address}</div>
                    {p.sf && <div>Size: {p.sf} SF</div>}
                    {(p.askingRent || p.askingPrice) && <div>Asking: {p.askingRent || p.askingPrice}</div>}
                    {p.nearestHighway && (
                      <div style={{ marginTop: 4, fontSize: '12px', color: '#e2c47a' }}>
                        {'\u{1F6E3}\uFE0F'} {p.nearestHighway.distance_miles} mi to {p.nearestHighway.name}{p.nearestHighway.description ? ` (${p.nearestHighway.description})` : ''}
                      </div>
                    )}
                    {p.notes && <div className="survey-popup-notes">{p.notes}</div>}
                    {p.recommended && <div className="survey-popup-rec">{'★'} Recommended</div>}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Retailer markers (smart clusters + collision avoidance) */}
          <SmartClusterLayer
            propertyLatLng={center}
            connectorDataRef={connectorDataRef}
            isExportingRef={isExportingRef}
            radiusMiles={2}
          >
            {filteredRetailers.map((r, i) => {
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
                  <div class="popup-address">${r.address}</div>`,
              };
            })}
          </SmartClusterLayer>

          {/* Survey legend overlay on map */}
          <SurveyLegend title={surveyTitle} properties={properties} />
        </MapContainer>
      </div>
    </div>
  );
}

// ── Map legend component ─────────────────────────────────────────────
function SurveyLegend({ title, properties }) {
  const map = useMap();
  const containerRef = useRef(null);

  useEffect(() => {
    if (!map || !containerRef.current) return;

    const legend = L.control({ position: 'bottomleft' });

    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'survey-map-legend');
      const items = properties
        .filter(p => p.geocoded)
        .map((p, i) => {
          const isRec = p.recommended && p.rank <= 4;
          const dot = isRec ? '#2E7D32' : '#546E7A';
          const star = isRec ? '★ ' : '';
          const num = p.rank || i + 1;
          const name = p.name || p.address?.split(',')[0] || `Property ${num}`;
          return `<div class="legend-item">
            <span class="legend-dot" style="background:${dot}">${num}</span>
            <span class="legend-name">${star}${name}</span>
          </div>`;
        })
        .join('');

      div.innerHTML = `
        <div class="legend-title">${title}</div>
        ${items}
      `;

      L.DomEvent.disableClickPropagation(div);
      return div;
    };

    legend.addTo(map);
    return () => legend.remove();
  }, [map, title, properties]);

  return <div ref={containerRef} />;
}
