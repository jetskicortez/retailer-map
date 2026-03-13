# Retailer Map Generator — The Colony Agency

A commercial real estate tool that generates visual trade area retailer maps for property listings. Enter an address, radius, and property type to instantly see nearby national and regional retailers on an interactive dark-themed map.

## Setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Add your Anthropic API key

Open the `.env` file in the project root and replace the placeholder with your key:

```
ANTHROPIC_API_KEY=sk-ant-...your-key-here
```

### 3. Start the app

```bash
npm run dev
```

This starts both the Express proxy server (port 3001) and the Vite dev server concurrently.

**Open the app at** [http://localhost:5173](http://localhost:5173)

## Architecture

- **client/** — Vite + React frontend with Leaflet.js map
- **server/** — Express proxy that forwards requests to the Anthropic API server-side, keeping the API key out of the browser
- API calls are proxied through `/api/claude` to avoid CORS issues and protect the key

## Usage

1. Enter a property address (e.g. `533 Depot St, Latrobe, PA`)
2. Select a search radius (1–5 miles)
3. Choose the property type
4. Click **Generate Map**
5. Browse retailers in the sidebar or click markers on the map
6. Click **Export CSV** to download the data
