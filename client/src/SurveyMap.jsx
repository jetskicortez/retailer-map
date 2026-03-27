import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  MapContainer,
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

// ── Shared constants (subset from App.jsx) ───────────────────────────
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
        />

        <label className="survey-form-label">Properties</label>
        <textarea
          className="survey-form-textarea"
          rows={12}
          placeholder={placeholder}
          value={textInput}
          onChange={e => setTextInput(e.target.value)}
        />

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

  const mapRef = useRef(null);
  const mapPanelRef = useRef(null);
  const cardRefs = useRef({});

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
  const handleExportPNG = useCallback(async () => {
    if (!mapPanelRef.current) return;
    try {
      const canvas = await html2canvas(mapPanelRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: '#0f1923',
        width: mapPanelRef.current.offsetWidth,
        height: mapPanelRef.current.offsetHeight,
      });

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
  }, [surveyTitle]);

  const handleExportPDF = useCallback(async () => {
    if (!mapPanelRef.current) return;
    try {
      const canvas = await html2canvas(mapPanelRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: '#0f1923',
        width: mapPanelRef.current.offsetWidth,
        height: mapPanelRef.current.offsetHeight,
      });

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
  }, [surveyTitle]);

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
                      {isRec && <span className="survey-star">\u2605</span>}
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
                          {'\u{1F6E3}\uFE0F'} {p.nearestHighway.distance_miles} mi to {p.nearestHighway.name}
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
                      <div style={{ marginTop: 4, fontSize: '12px', color: '#555' }}>
                        {'\u{1F6E3}\uFE0F'} {p.nearestHighway.distance_miles} mi to {p.nearestHighway.name}
                      </div>
                    )}
                    {p.notes && <div className="survey-popup-notes">{p.notes}</div>}
                    {p.recommended && <div className="survey-popup-rec">\u2605 Recommended</div>}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Retailer markers */}
          {filteredRetailers.map((r, i) => (
            <Marker
              key={`ret-${r.placeId || i}`}
              position={[r.lat, r.lng]}
              icon={getLogoUrl(r.name) ? createLogoIcon(getLogoUrl(r.name), r.name) : createRetailerIcon(r.category)}
            >
              <Popup>
                <strong>{r.name}</strong>
                <div>{r.category}</div>
                <div style={{ fontSize: '0.85em', color: '#666' }}>{r.address}</div>
                {r.rating && <div>Rating: {r.rating} ({r.userRatingCount} reviews)</div>}
              </Popup>
            </Marker>
          ))}

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
          const star = isRec ? '\u2605 ' : '';
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
