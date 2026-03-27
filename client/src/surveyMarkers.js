import L from 'leaflet';

// ── Recommended property marker (Top 4 — green pin with gold star) ──
export function createRecommendedIcon(rank, name) {
  const label = name || `Property ${rank}`;
  const labelW = Math.max(140, label.length * 8.5 + 32);
  const id = `rec-${rank}-${Date.now()}`;
  const html = `<div class="survey-marker recommended">
    <div class="survey-marker-label">${label}</div>
    <div class="survey-marker-pin">
      <svg width="40" height="50" viewBox="0 0 40 50" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="recPinGrad-${id}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#43A047"/>
            <stop offset="100%" stop-color="#2E7D32"/>
          </linearGradient>
          <filter id="recShadow-${id}" x="-20%" y="-10%" width="140%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.4"/>
          </filter>
        </defs>
        <path d="M20 47C20 47 38 30 38 18C38 9 30 2 20 2C10 2 2 9 2 18C2 30 20 47 20 47Z"
              fill="url(#recPinGrad-${id})" stroke="#fff" stroke-width="2" filter="url(#recShadow-${id})"/>
        <circle cx="20" cy="18" r="11" fill="#fff" opacity="0.95"/>
        <text x="20" y="23" text-anchor="middle" font-size="14" font-weight="700" fill="#2E7D32"
              font-family="'DM Sans', Arial, sans-serif">${rank}</text>
      </svg>
      <div class="survey-star-badge">
        <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
          <polygon points="8,1 10,6 15,6.5 11.5,9.5 12.5,15 8,12 3.5,15 4.5,9.5 1,6.5 6,6"
                   fill="#c9a84c" stroke="#0f1923" stroke-width="0.5"/>
        </svg>
      </div>
    </div>
  </div>`;
  return L.divIcon({
    html,
    className: '',
    iconSize: [labelW, 82],
    iconAnchor: [labelW / 2, 82],
    popupAnchor: [0, -82],
  });
}

// ── Numbered property marker (5+ — slate blue pin with number) ──────
export function createNumberedIcon(number, name) {
  const label = name || `Property ${number}`;
  const labelW = Math.max(140, label.length * 8.5 + 32);
  const id = `num-${number}-${Date.now()}`;
  const html = `<div class="survey-marker numbered">
    <div class="survey-marker-label">${label}</div>
    <div class="survey-marker-pin">
      <svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="numPinGrad-${id}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#78909C"/>
            <stop offset="100%" stop-color="#546E7A"/>
          </linearGradient>
          <filter id="numShadow-${id}" x="-20%" y="-10%" width="140%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.35"/>
          </filter>
        </defs>
        <path d="M18 43C18 43 34 27 34 16C34 8 27 2 18 2C9 2 2 8 2 16C2 27 18 43 18 43Z"
              fill="url(#numPinGrad-${id})" stroke="#fff" stroke-width="1.5" filter="url(#numShadow-${id})"/>
        <circle cx="18" cy="16" r="9" fill="#fff" opacity="0.95"/>
        <text x="18" y="20.5" text-anchor="middle" font-size="12" font-weight="700" fill="#546E7A"
              font-family="'DM Sans', Arial, sans-serif">${number}</text>
      </svg>
    </div>
  </div>`;
  return L.divIcon({
    html,
    className: '',
    iconSize: [labelW, 76],
    iconAnchor: [labelW / 2, 76],
    popupAnchor: [0, -76],
  });
}
