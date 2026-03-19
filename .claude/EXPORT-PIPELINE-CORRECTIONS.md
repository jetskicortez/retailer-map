# Export Pipeline Corrections Log

Session date: 2026-03-19
Branch: `claude/debug-undefined-error-aODrt`

---

## Context

The PNG/PDF export pipeline in `App.jsx` captures the Leaflet map via `html2canvas`, then redraws certain elements on canvas (radius ring, connector lines) because Leaflet's SVG overlays have `translate3d` offset issues that cause mispositioned elements in html2canvas captures.

---

## Problem 1: Connector Lines Clipped Around Property Marker

**What happened**: Connector lines were clipped using Liang-Barsky line clipping to exclude portions inside the property marker's bounding box. This created visible gaps where lines abruptly stopped/started at the edges of an invisible rectangle around the property marker.

**Root cause**: The `clipLineOutsideRect()` function removed line segments inside `propBoxContainer` (which had `PROP_CLIP_PAD = 14px` of extra padding). Lines appeared to "avoid" the property marker in an unnatural rectangular zone.

**Fix**: Removed all clipping logic. Connector lines now draw in full from logo to retailer position with no cutoff.

**Rule**: Never clip connector lines. They should draw continuously and be covered by markers that sit on top.

---

## Problem 2: Rectangular Re-stamp Buffer Zone

**What happened**: After drawing connector lines on canvas, the property marker was re-stamped from `rawCanvas` (the capture without connectors) using a single union bounding box around the label + pin. This copied a rectangle of map tiles along with the marker, creating a visible "buffer zone" where connector lines disappeared.

**Root cause**: The re-stamp copied a rectangular region that included:
- The label pixels (desired)
- The pin pixels (desired)
- The gap between label and pin filled with map tiles (NOT desired — this covered connector lines)
- Extra padding (`PROP_CLIP_PAD=14` + `STAMP_EXTRA=4` = 18px beyond the marker edges)

**Fix**: Removed the single union bounding box. Instead, measure the label and pin DOM elements separately via `getBoundingClientRect()` and re-stamp each independently with zero padding.

**Rule**: When re-stamping elements from rawCanvas to sit on top of connector lines, always re-stamp each visual element (label, pin, logo) as its own independent tight rectangle. Never merge multiple elements into one bounding box — the gap between them would cover the map.

---

## Problem 3: Canvas-Drawn Duplicate Marker

**What happened**: As an attempted fix, the property marker was drawn using canvas primitives (teardrop path, gradient, star, rounded rect label, letter-spaced text). This created a second property marker on top of the one already captured in rawCanvas.

**Root cause**: rawCanvas already contains the property marker from the html2canvas capture. Drawing another one via canvas primitives creates a duplicate.

**Fix**: Reverted to re-stamping from rawCanvas (which already has the correct marker) but with the independent-element approach from Problem 2.

**Rule**: Never draw a duplicate of something that already exists in rawCanvas. The purpose of re-stamping is to restore the EXISTING marker pixels on top of connector lines, not to create new ones.

---

## Correct Export Layer Order

The final correct approach for the export canvas compositing:

```
Layer 1:   rawCanvas (html2canvas capture — map tiles + all markers, NO connectors/SVGs)
Layer 1.5: Radius ring (drawn on canvas — avoids SVG translate3d offset bug)
Layer 2:   Connector lines (drawn on canvas in full — no clipping)
Layer 2.5: Endpoint dots at actual retailer positions
Layer 3:   Re-stamp retailer logo regions from rawCanvas (each logo independently)
Layer 3.5: Re-stamp property LABEL from rawCanvas (tight, independent box)
Layer 3.6: Re-stamp property PIN from rawCanvas (tight, independent box)
```

Key principles:
- Connector lines draw UNDER markers (markers re-stamped on top)
- Each re-stamp is an INDEPENDENT tight rectangle matching the element's DOM bounds
- Zero padding on property element re-stamps
- The property label and pin are SEPARATE re-stamps (not one merged box)
- rawCanvas already contains all marker visuals — never redraw them from scratch

---

## DOM Measurement Pattern (Correct)

```javascript
const propElementBoxes = [];
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
```

Each element measured and re-stamped independently. No union. No padding.
