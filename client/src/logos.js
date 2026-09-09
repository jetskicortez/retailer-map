import L from 'leaflet';

import { RETAILER_DOMAINS, LOGO_FILES, _resolveName, getBrandKey } from './brands.js';
export { RETAILER_DOMAINS, LOGO_FILES, _resolveName, getBrandKey };


export function getLogoUrl(retailerName) {
  const normalized = retailerName.toLowerCase().trim();
  const { domain, file } = _resolveName(normalized);
  if (!domain && !file) return null;
  // Local logos (212+ PNGs) as primary — reliable, no API dependency.
  // BrandFetch proxy (/api/logo/:domain) as secondary for known brands without
  // a checked-in PNG. Brands with neither render as text tiles (last resort)
  // so exports never contain blank logo boxes.
  return file ? `/logos/${file}` : `/api/logo/${domain}`;
}

// Get BrandFetch proxy fallback URL for onerror handling (when local logo fails)
export function getFallbackLogoUrl(retailerName) {
  const normalized = retailerName.toLowerCase().trim();
  const { domain } = _resolveName(normalized);
  return domain ? `/api/logo/${domain}` : null;
}

export const LOGO_H = 46; // Fixed height for all logo markers
export const LOGO_MIN_W = 36; // Minimum width (narrow/square logos)
export const LOGO_MAX_W = 150; // Maximum width — auto-expand for wide wordmarks (Dunkin', Subway, etc.)

// Cache of logo natural dimensions: url → { w, h, aspect }
export const logoDimCache = {};

export function preloadLogo(url) {
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
export function getLogoMarkerW(logoUrl) {
  const cached = logoDimCache[logoUrl];
  if (!cached) return LOGO_MIN_W;
  // Scale width to maintain aspect ratio at fixed height
  const innerH = LOGO_H - 19; // padding (8px×2) + border (1.5px×2) overhead
  const naturalW = innerH * cached.aspect + 19; // add back padding + border
  return Math.max(LOGO_MIN_W, Math.min(LOGO_MAX_W, Math.round(naturalW)));
}

export function createLogoIcon(logoUrl, retailerName, count = 1) {
  const markerW = getLogoMarkerW(logoUrl);
  // Inner dimensions after padding (8px) and border (1.5px) on each side
  const innerW = markerW - 19;
  const innerH = LOGO_H - 19;

  // Try BrandFetch once, then fall back to a readable text tile.
  const fallback = retailerName ? getFallbackLogoUrl(retailerName) : null;
  const badge = count > 1 ? `<div class="logo-count-badge">${count}</div>` : '';
  const fallbackHtml = `${badge}<span class=logo-marker-fallback-text>${escapeHtml(shortenRetailerName(retailerName))}</span>`;
  const fallbackJs = escapeJsString(fallbackHtml);

  const errorHandler = (fallback && fallback !== logoUrl
    ? `this.onerror=function(){this.onerror=null;this.parentElement.innerHTML='${fallbackJs}'};this.src='${fallback}'`
    : `this.onerror=null;this.parentElement.innerHTML='${fallbackJs}'`
  ).replace(/"/g, '&quot;'); // fallback HTML carries double quotes — must not terminate the onerror attribute

  return L.divIcon({
    html: `<div class="logo-marker" style="width:${markerW}px;height:${LOGO_H}px;">${badge}<img src="${logoUrl}" alt="" width="${innerW}" height="${innerH}" style="object-fit:contain;" onerror="${errorHandler}" /></div>`,
    className: '',
    iconSize: [markerW, LOGO_H],
    iconAnchor: [markerW / 2, LOGO_H / 2],
    popupAnchor: [0, -LOGO_H / 2],
  });
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

function shortenRetailerName(name) {
  return String(name || 'Retailer')
    .replace(/\s*\([^)]*\)/g, '')          // location qualifiers: "(PA Tpk Exit 67)"
    .replace(/\s+by\s+[A-Z][\w&' ]*$/, '') // franchise suffixes: "by IHG"
    .replace(/\s+Inc\.?$/i, '')
    .replace(/\s+LLC\.?$/i, '')
    .replace(/\s+Restaurant$/i, '')
    .trim();
}

export function createTextLogoIcon(retailerName, count = 1) {
  const label = shortenRetailerName(retailerName);
  const markerW = Math.max(78, Math.min(LOGO_MAX_W, Math.round(label.length * 6.2 + 28)));
  const badge = count > 1 ? `<div class="logo-count-badge">${count}</div>` : '';

  return L.divIcon({
    html: `<div class="logo-marker logo-marker-text" style="width:${markerW}px;height:${LOGO_H}px;">${badge}<span>${escapeHtml(label)}</span></div>`,
    className: '',
    iconSize: [markerW, LOGO_H],
    iconAnchor: [markerW / 2, LOGO_H / 2],
    popupAnchor: [0, -LOGO_H / 2],
  });
}
