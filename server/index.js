import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import express from 'express';
import cors from 'cors';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env'), override: true });

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'Server configuration error: ANTHROPIC_API_KEY is not set in .env',
    });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || `Anthropic API error: ${response.status}`,
      });
    }

    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({
      error: `Failed to reach Anthropic API: ${err.message}`,
    });
  }
});

// ── Geocode via Google Maps Geocoding API ─────────────────────────
async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'YOUR_KEY_HERE') return null;

  const url = `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({
    address,
    key: apiKey,
  })}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'OK' && data.results.length > 0) {
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  }
  return null;
}

// ── Geocode single address endpoint ──────────────────────────────
app.post('/api/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'Address required' });
    const result = await geocodeAddress(address);
    res.json(result || { error: 'Address not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Batch geocode retailer addresses ─────────────────────────────
app.post('/api/geocode-batch', async (req, res) => {
  try {
    const { addresses } = req.body;
    if (!Array.isArray(addresses)) {
      return res.status(400).json({ error: 'addresses array required' });
    }
    const results = await Promise.all(
      addresses.map((addr) => geocodeAddress(addr))
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── National brand list for chain classification ─────────────────
const NATIONAL_BRANDS = new Set([
  // Grocery
  'Walmart', 'Walmart Supercenter', 'Walmart Neighborhood Market', 'Target', 'Kroger', 'Costco',
  'Costco Wholesale', "Sam's Club", 'Aldi', 'ALDI', 'Lidl', 'Trader Joe\'s', 'Whole Foods Market',
  'Whole Foods', 'Publix', 'Safeway', 'Albertsons', 'H-E-B', 'Meijer', 'Food Lion', 'Giant Eagle',
  'Giant Food', 'Stop & Shop', 'ShopRite', 'Wegmans', 'Winn-Dixie', 'Piggly Wiggly', 'Save A Lot',
  'Sprouts Farmers Market', 'Fresh Market', 'Harris Teeter', 'Hy-Vee',
  // Pharmacy
  'CVS Pharmacy', 'CVS', 'Walgreens', 'Rite Aid', 'Rite-Aid',
  // Fast Food
  "McDonald's", 'Burger King', "Wendy's", 'Taco Bell', 'KFC', "Chick-fil-A", 'Popeyes',
  "Popeyes Louisiana Kitchen", 'Sonic Drive-In', 'Sonic', "Jack in the Box", "Arby's",
  "Hardee's", "Carl's Jr.", 'Five Guys', "Raising Cane's", "Zaxby's", "Wingstop",
  "Whataburger", "Culver's", "Firehouse Subs", "Jimmy John's", "Jersey Mike's",
  "Jersey Mike's Subs", 'Subway', "Panda Express", "Chipotle", "Chipotle Mexican Grill",
  "Qdoba", "Qdoba Mexican Eats", "Moe's Southwest Grill",
  // Pizza
  "Domino's", "Domino's Pizza", 'Pizza Hut', "Little Caesars", "Little Caesar's",
  "Papa John's", "Papa Johns", "Papa Murphy's", "Marco's Pizza",
  // Casual Dining
  "Applebee's", "Applebee's Grill + Bar", "Chili's", "Chili's Grill & Bar",
  'Olive Garden', 'Red Lobster', 'Outback Steakhouse', 'Cracker Barrel',
  'Cracker Barrel Old Country Store', "Denny's", 'IHOP', 'TGI Fridays',
  "Buffalo Wild Wings", 'Golden Corral', 'Texas Roadhouse', 'LongHorn Steakhouse',
  'Red Robin', 'Red Robin Gourmet Burgers', "Bob Evans", "Bob Evans Restaurant",
  "Waffle House", "Perkins", "Perkins Restaurant & Bakery", "Panera Bread", "Panera",
  // Coffee
  'Starbucks', "Dunkin'", 'Dunkin', "Dunkin' Donuts", "Tim Hortons",
  "Peet's Coffee", "Dutch Bros Coffee", "Dutch Bros",
  // Fitness
  'Planet Fitness', 'Anytime Fitness', 'LA Fitness', 'Gold\'s Gym', 'Orangetheory Fitness',
  'Orangetheory', 'Snap Fitness', 'Crunch Fitness', 'Crunch', 'CrossFit', 'YMCA', 'Equinox',
  // Home Improvement
  'Home Depot', 'The Home Depot', "Lowe's", "Lowe's Home Improvement", 'Menards',
  'Ace Hardware', 'True Value', 'Tractor Supply Co.', 'Tractor Supply',
  // Banking
  'Chase', 'JPMorgan Chase', 'Bank of America', 'Wells Fargo', 'Citibank', 'US Bank',
  'U.S. Bank', 'PNC Bank', 'PNC', 'TD Bank', 'Citizens Bank', 'Citizens',
  'Truist', 'Truist Bank', 'Capital One', 'Regions Bank', 'Fifth Third Bank',
  'Huntington Bank', 'KeyBank', 'M&T Bank', 'BB&T',
  // Auto
  'AutoZone', 'Advance Auto Parts', "O'Reilly Auto Parts", 'NAPA Auto Parts',
  'Jiffy Lube', 'Valvoline Instant Oil Change', 'Valvoline', 'Midas', 'Firestone',
  'Firestone Complete Auto Care', 'Pep Boys', 'Maaco', 'Meineke', 'Goodyear',
  'Goodyear Auto Service', 'Discount Tire', 'Les Schwab',
  // Department Store / Big Box
  'Kohl\'s', "Kohl's", 'JCPenney', 'Macy\'s', "Macy's", 'Nordstrom', 'Nordstrom Rack',
  'TJ Maxx', 'TJMaxx', 'T.J. Maxx', 'Marshalls', 'Ross', 'Ross Dress for Less',
  'Burlington', 'Burlington Coat Factory',
  // Discount / Value
  'Dollar General', 'Dollar Tree', 'Family Dollar', 'Five Below', 'Big Lots',
  'Ollie\'s Bargain Outlet', "Ollie's", 'Tuesday Morning', '99 Cents Only',
  // Pet
  'PetSmart', 'Petco', 'Pet Supplies Plus',
  // Cellular / Tech
  'Verizon', 'Verizon Wireless', 'AT&T', 'T-Mobile', 'Sprint', 'Best Buy',
  'GameStop', 'Apple Store', 'Apple',
  // Convenience / Gas
  'Sheetz', 'Wawa', '7-Eleven', 'Circle K', 'QuikTrip', 'QT', 'Speedway',
  'Casey\'s', "Casey's General Store", 'Pilot Flying J', 'RaceTrac', 'Buc-ee\'s',
  "Buc-ee's", 'GetGo', 'Kum & Go', 'Kwik Trip', 'Thorntons', 'Mapco',
  'Shell', 'BP', 'ExxonMobil', 'Chevron', 'Sunoco', 'Marathon',
  // Entertainment
  'AMC Theatres', 'AMC', 'Regal Cinemas', 'Regal', 'Cinemark', 'Dave & Buster\'s',
  "Dave & Buster's", 'Chuck E. Cheese', 'Topgolf', 'Main Event',
  // Specialty Retail
  'Bed Bath & Beyond', 'Bath & Body Works', 'Ulta Beauty', 'Ulta', 'Sephora',
  'Sally Beauty', 'GNC', 'Vitamin Shoppe', 'The Vitamin Shoppe',
  'Staples', 'Office Depot', 'OfficeMax', 'FedEx Office', 'The UPS Store',
  'Hobby Lobby', 'Michaels', 'Joann Fabrics', 'JOANN',
  'Dick\'s Sporting Goods', "Dick's Sporting Goods", 'Academy Sports',
  'Academy Sports + Outdoors', 'REI', 'Bass Pro Shops', "Cabela's",
  'Old Navy', 'Gap', 'Banana Republic', 'H&M', 'Zara', 'Forever 21',
  'Foot Locker', 'Finish Line',
]);

function classifyChainSize(name) {
  if (NATIONAL_BRANDS.has(name)) return 'National';
  // Check partial matches for brands with location suffixes
  for (const brand of NATIONAL_BRANDS) {
    if (name.startsWith(brand) || brand.startsWith(name)) return 'National';
  }
  return 'Regional/Local';
}

// ── Google Places Nearby Search ──────────────────────────────────

const PLACE_TYPE_BATCHES = [
  ['restaurant', 'fast_food_restaurant'],
  ['cafe', 'coffee_shop'],
  ['supermarket', 'grocery_store', 'convenience_store'],
  ['department_store', 'clothing_store', 'electronics_store', 'discount_store'],
  ['shopping_mall', 'shoe_store', 'book_store', 'jewelry_store'],
  ['pharmacy', 'drugstore', 'gym'],
  ['bank', 'gas_station', 'car_repair', 'car_wash'],
  ['home_improvement_store', 'pet_store', 'furniture_store'],
  ['auto_parts_store', 'liquor_store'],
  ['movie_theater', 'bowling_alley'],
];

const GOOGLE_TYPE_TO_CATEGORY = {
  supermarket: 'Grocery',
  grocery_store: 'Grocery',
  pharmacy: 'Pharmacy',
  drugstore: 'Pharmacy',
  fast_food_restaurant: 'Fast Food',
  restaurant: 'Casual Dining',
  meal_takeaway: 'Fast Food',
  cafe: 'Coffee',
  coffee_shop: 'Coffee',
  gym: 'Fitness',
  home_improvement_store: 'Home Improvement',
  bank: 'Banking',
  car_repair: 'Auto',
  car_wash: 'Auto',
  auto_parts_store: 'Auto',
  gas_station: 'Convenience',
  movie_theater: 'Entertainment',
  bowling_alley: 'Entertainment',
  department_store: 'Department Store',
  shopping_mall: 'Department Store',
  discount_store: 'Discount/Value',
  pet_store: 'Pet',
  electronics_store: 'Cellular/Tech',
  convenience_store: 'Convenience',
  clothing_store: 'Other',
  furniture_store: 'Other',
  book_store: 'Other',
  liquor_store: 'Other',
  shoe_store: 'Other',
  jewelry_store: 'Other',
};

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapTypeToCategory(primaryType, types) {
  if (primaryType && GOOGLE_TYPE_TO_CATEGORY[primaryType]) {
    return GOOGLE_TYPE_TO_CATEGORY[primaryType];
  }
  if (types) {
    for (const t of types) {
      if (GOOGLE_TYPE_TO_CATEGORY[t]) return GOOGLE_TYPE_TO_CATEGORY[t];
    }
  }
  return 'Other';
}

async function searchNearbyPlaces(lat, lng, radiusMeters, includedTypes, apiKey) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.primaryType',
    },
    body: JSON.stringify({
      includedTypes,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
      rankPreference: 'DISTANCE',
      maxResultCount: 20,
    }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('Places API error:', data.error.message);
    return [];
  }
  return data.places || [];
}

// Generate offset search points in cardinal + intercardinal directions
// This catches corridor retailers that fall outside the top-20 closest to center
function getSearchPoints(lat, lng, radiusMiles) {
  const points = [{ lat, lng }]; // always include center
  if (radiusMiles <= 2) return points; // small radius doesn't need extra points

  // Offset ~60% of radius in 4 cardinal directions
  const offsetMiles = radiusMiles * 0.6;
  const latOffset = offsetMiles / 69.0; // ~69 miles per degree latitude
  const lngOffset = offsetMiles / (69.0 * Math.cos((lat * Math.PI) / 180));

  points.push(
    { lat: lat + latOffset, lng },               // North
    { lat: lat - latOffset, lng },               // South
    { lat, lng: lng + lngOffset },               // East
    { lat, lng: lng - lngOffset },               // West
  );
  return points;
}

// Google Places Text Search — supplementary search for national chains
async function textSearchPlaces(query, lat, lng, radiusMeters, apiKey) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.primaryType',
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
      maxResultCount: 20,
    }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('Text Search API error:', data.error.message);
    return [];
  }
  return data.places || [];
}

app.post('/api/places-nearby', async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'YOUR_KEY_HERE') {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
  }

  try {
    const { lat, lng, radiusMiles, propertyAddress } = req.body;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const radiusMi = parseFloat(radiusMiles) || 3;
    const radiusMeters = radiusMi * 1609.34;
    const minRatingCount = 30; // Lowered from 50 to catch chains in smaller markets

    // Get search points (center + 4 cardinal offsets for larger radii)
    const searchPoints = getSearchPoints(lat, lng, radiusMi);

    // For each search point, run all type batches in parallel
    const allPromises = [];
    for (const point of searchPoints) {
      for (const types of PLACE_TYPE_BATCHES) {
        allPromises.push(
          searchNearbyPlaces(point.lat, point.lng, radiusMeters, types, apiKey)
        );
      }
    }

    // Supplementary text searches for common national chains that may be missed
    const textQueries = [
      'national retail stores',
      'fast food chains',
      'auto parts stores',
    ];
    for (const query of textQueries) {
      allPromises.push(
        textSearchPlaces(query, lat, lng, radiusMeters, apiKey)
      );
    }

    const batchResults = await Promise.allSettled(allPromises);

    // Flatten results
    const allPlaces = [];
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        allPlaces.push(...result.value);
      }
    }

    // Deduplicate by place ID
    const seen = new Set();
    const unique = [];
    for (const place of allPlaces) {
      if (!seen.has(place.id)) {
        seen.add(place.id);
        unique.push(place);
      }
    }

    // Filter: national brands always pass; others need minimum reviews
    let filtered = unique.filter((p) => {
      const name = p.displayName?.text || '';
      if (classifyChainSize(name) === 'National') return true;
      return (p.userRatingCount || 0) >= minRatingCount;
    });

    // If too few results, lower the threshold
    if (filtered.length < 15) {
      filtered = unique.filter((p) => (p.userRatingCount || 0) >= 10);
    }
    if (filtered.length < 10) {
      filtered = unique; // Use all results
    }

    // Map to app format, filter to only include places within the actual radius
    const mapped = filtered
      .map((p) => {
        const name = p.displayName?.text || 'Unknown';
        return {
          name,
          category: mapTypeToCategory(p.primaryType, p.types),
          address: p.formattedAddress || '',
          lat: p.location?.latitude || 0,
          lng: p.location?.longitude || 0,
          distance_miles: haversine(lat, lng, p.location?.latitude || 0, p.location?.longitude || 0),
          rating: p.rating || null,
          userRatingCount: p.userRatingCount || 0,
          placeId: p.id,
          chainSize: classifyChainSize(name),
        };
      })
      .filter((r) => r.distance_miles <= radiusMi); // Only include places within requested radius

    // Deduplicate sub-departments of the same parent store
    // e.g. "Walmart Pharmacy", "Walmart Auto Care Center", "Walmart Photo Center"
    // should all collapse to "Walmart Supercenter" (the one with most reviews)
    const PARENT_BRANDS = [
      'Walmart', 'CVS', 'Walgreens', 'Giant Eagle', 'Kroger', 'Target',
      'Costco', "Sam's Club", 'Meijer', 'Publix', 'Safeway', 'Albertsons',
    ];

    function getParentBrand(name) {
      for (const brand of PARENT_BRANDS) {
        if (name.startsWith(brand)) return brand;
      }
      return null;
    }

    // Group by parent brand + proximity (within 0.1 mi = same physical location)
    const retailers = [];
    const used = new Set();

    // First pass: find parent-brand clusters
    for (let i = 0; i < mapped.length; i++) {
      if (used.has(i)) continue;
      const r = mapped[i];
      const parent = getParentBrand(r.name);

      if (!parent) {
        continue; // handle non-parent-brand entries in second pass
      }

      // Find all entries for this parent brand within 0.1 miles of each other
      const cluster = [i];
      for (let j = i + 1; j < mapped.length; j++) {
        if (used.has(j)) continue;
        const s = mapped[j];
        if (getParentBrand(s.name) === parent &&
            haversine(r.lat, r.lng, s.lat, s.lng) < 0.2) {
          cluster.push(j);
        }
      }

      // Keep the one with the most reviews (the main store)
      let best = cluster[0];
      for (const idx of cluster) {
        if ((mapped[idx].userRatingCount || 0) > (mapped[best].userRatingCount || 0)) {
          best = idx;
        }
      }

      retailers.push(mapped[best]);
      for (const idx of cluster) used.add(idx);
    }

    // Second pass: add non-parent-brand entries
    for (let i = 0; i < mapped.length; i++) {
      if (!used.has(i)) {
        retailers.push(mapped[i]);
      }
    }

    // Sort by distance
    retailers.sort((a, b) => a.distance_miles - b.distance_miles);

    console.log(`Found ${unique.length} unique places, ${filtered.length} after filtering, ${retailers.length} within ${radiusMi}mi radius`);

    res.json({
      property: { lat, lng, display: propertyAddress || `${lat}, ${lng}` },
      retailers,
    });
  } catch (err) {
    console.error('Places nearby error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
