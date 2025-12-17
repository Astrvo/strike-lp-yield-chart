const https = require('https');
const url = require('url');

const API_URL = 'https://app.strikefinance.org/api/perpetuals/getHistoricalRatios';
const LIVE_API_URL = 'https://app.strikefinance.org/api/perpetuals/ratios';
const CG_API_KEY = 'CG-zdXqbkDWtCUhFgwBBAkXDwBv';

const LIVE_CACHE = { timestamp: 0, data: null };
const LIVE_CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes

const PRICE_CACHE = {};
const CACHE_DURATION = 60 * 60 * 1000; // 1 Hour

// Helper: Async Request
function httpsGet(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('JSON Parse Error'));
                    }
                } else {
                    const err = new Error(`API Error: ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    resolve({ error: true, statusCode: res.statusCode }); // Resolve to handle 401 gracefully
                }
            });
        });
        req.on('error', reject);
    });
}

// Helper: Fetch Coin Data (Handles Cache + 401 Retry)
async function getCoinData(coinId) {
    const now = Date.now();
    // Check Cache
    if (PRICE_CACHE[coinId] && (now - PRICE_CACHE[coinId].timestamp < CACHE_DURATION)) {
        console.log(`[Proxy] Cache Hit: ${coinId}`);
        return PRICE_CACHE[coinId].data;
    }

    console.log(`[Proxy] Cache Miss: ${coinId}. Fetching...`);
    const headers = {
        'User-Agent': 'Mozilla/5.0/Vercel',
        'Accept': 'application/json',
        'x-cg-demo-api-key': CG_API_KEY
    };

    // Try MAX first
    let result = await httpsGet(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=max`,
        { headers }
    );

    // Fallback to 365 if 401
    if (result.error && result.statusCode === 401) {
        console.log(`[Proxy] 401 on MAX. Retrying ${coinId} with 365 days...`);
        result = await httpsGet(
            `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=365`,
            { headers }
        );
    }

    if (result.error) {
        throw new Error(`Failed to fetch ${coinId}: ${result.statusCode}`);
    }

    // Cache it
    PRICE_CACHE[coinId] = { timestamp: Date.now(), data: result };
    return result;
}

// Compute Cross Rate
function computeCrossRate(targetData, baseData) {
    // targetData: prices [[t, p], ...], baseData: prices [[t, p], ...] (ADA)
    // We iterate targetData and find closest timestamp in baseData

    if (!targetData.prices || !baseData.prices) return { prices: [] };

    const baseMap = new Map();
    baseData.prices.forEach(p => {
        // Round to nearest hour (approx) to increase hit rate? 
        // Or just store raw. Timestamps usually align if fetched closely.
        // Let's optimize: sort baseData by time (should be sorted) and use binary search or pointer.
        // Simple map for exact match first.
        baseMap.set(p[0], p[1]);
    });

    const computedPrices = [];

    // Sort base prices for fallback lookups
    const basePrices = baseData.prices.sort((a, b) => a[0] - b[0]);

    targetData.prices.forEach(([t, price]) => {
        let basePrice = baseMap.get(t);

        if (!basePrice) {
            // Find closest
            // Since both are time series, we can do a quick search. 
            // Simple naive search for now (or assume rough alignment).
            // Let's just find the closest one within reasonable window (e.g. 24h)
            const closest = basePrices.reduce((prev, curr) => {
                return (Math.abs(curr[0] - t) < Math.abs(prev[0] - t) ? curr : prev);
            });

            if (Math.abs(closest[0] - t) < 24 * 60 * 60 * 1000) { // Within 24h
                basePrice = closest[1];
            }
        }

        if (basePrice) {
            computedPrices.push([t, price / basePrice]);
        }
    });

    return { ...targetData, prices: computedPrices };
}

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // RATIO PROXY
    if (req.url === '/api/ratios') {
        try {
            // Helper: Get Live Rates
            async function getLiveRates() {
                const now = Date.now();
                if (LIVE_CACHE.data && (now - LIVE_CACHE.timestamp < LIVE_CACHE_DURATION)) {
                    return LIVE_CACHE.data;
                }

                try {
                    const data = await httpsGet(LIVE_API_URL);
                    if (data && data.daily) {
                        LIVE_CACHE.data = data.daily;
                        LIVE_CACHE.timestamp = now;
                        return data.daily;
                    }
                } catch (e) {
                    console.error('Failed to fetch live rates:', e);
                }
                return null;
            }

            // --- VERCEL BLOB CACHE LOGIC START ---
            const { put } = require('@vercel/blob');
            // We use fetch to read the blob since @vercel/blob `list` or `head` gives metadata, 
            // but we need the content. We can store the URL or just guess it?
            // Actually, for a single known file, `put` returns the url.
            // Ideally we should list to find it, or use a fixed URL if we knew it?
            // But Vercel Blob URLs are unique per put.
            // So we need to `list` to find the latest file named 'ratios-cache.json'.
            const { list } = require('@vercel/blob');

            const CACHE_FILENAME = 'ratios-cache.json';

            async function loadBlobCache() {
                try {
                    const { blobs } = await list({ prefix: CACHE_FILENAME, limit: 1 });
                    if (blobs.length > 0) {
                        const latest = blobs[0]; // List returns latest first by default? No, verifies below.
                        // Actually list returns data. blobs is array.
                        // Let's assume the first one matching prefix is mostly likely it if we clean up.
                        // But for simplicity, let's just GET the downloadUrl.
                        const response = await fetch(latest.url);
                        if (response.ok) {
                            return await response.json();
                        }
                    }
                } catch (e) {
                    console.error('Failed to load blob cache:', e);
                }
                return {};
            }

            async function saveBlobCache(cacheData) {
                try {
                    // Overwrite
                    await put(CACHE_FILENAME, JSON.stringify(cacheData, null, 2), {
                        access: 'public',
                        addRandomSuffix: false // Important to keep filename constant-ish or manageable
                    });
                    console.log('[Proxy] Blob cache saved.');
                } catch (e) {
                    console.error('Failed to save blob cache:', e);
                }
            }
            // --- VERCEL BLOB CACHE LOGIC END ---

            const data = await httpsGet(API_URL);

            // SANITIZATION LOGIC AND FILTERING
            if (data && data.success && data.data && data.data.assets) {
                const localCache = await loadBlobCache();
                let cacheUpdated = false;

                // Process each asset
                const assetKeys = Object.keys(data.data.assets);
                for (const assetKey of assetKeys) {
                    const asset = data.data.assets[assetKey];
                    if (asset.dailyRatios && Array.isArray(asset.dailyRatios)) {

                        // 1. Remove trailing invalid data
                        let i = asset.dailyRatios.length - 1;
                        while (i >= 0 && asset.dailyRatios[i].ratio === 1) {
                            i--;
                        }
                        // Cut off invalid tail
                        if (i < asset.dailyRatios.length - 1) {
                            asset.dailyRatios = asset.dailyRatios.slice(0, i + 1);
                        }

                        // 2. Merge with Local Cache
                        // Cache structure: { "SNEK": [ { "date": "...", "ratio": 1.23 } ] }
                        if (localCache[assetKey]) {
                            const cachedRatios = localCache[assetKey];
                            const lastApiDate = asset.dailyRatios.length > 0 ?
                                new Date(asset.dailyRatios[asset.dailyRatios.length - 1].date).getTime() : 0;

                            // Append cached items that are strictly NEWER than API data
                            for (const cachedItem of cachedRatios) {
                                const cachedTime = new Date(cachedItem.date).getTime();
                                if (cachedTime > lastApiDate) {
                                    // Check if duplicate (e.g. same day already added via cache)
                                    // Actually, just append if sorted.
                                    // Let's double check avoiding dups by date string
                                    const cachedDateStr = cachedItem.date.split('T')[0];
                                    const exists = asset.dailyRatios.some(r => r.date.split('T')[0] === cachedDateStr);
                                    if (!exists) {
                                        asset.dailyRatios.push(cachedItem);
                                    }
                                }
                            }
                        }

                        // 3. Check if we need to append Today's Live Ratio
                        const lastEntry = asset.dailyRatios.length > 0 ? asset.dailyRatios[asset.dailyRatios.length - 1] : null;
                        const todayStr = new Date().toISOString().split('T')[0];
                        const lastDateStr = lastEntry ? new Date(lastEntry.date).toISOString().split('T')[0] : '';

                        if (lastDateStr !== todayStr) {
                            // Fetch live rates lazily
                            // Helper: Get Live Rates
                            let liveRates = await getLiveRates();

                            if (liveRates) {
                                const liveAssetData = liveRates[assetKey] || liveRates[assetKey.toLowerCase()];
                                if (liveAssetData && liveAssetData.currentRatio && liveAssetData.currentRatio !== 1) {
                                    const newItem = {
                                        date: new Date().toISOString(), // Use Request Time
                                        ratio: liveAssetData.currentRatio
                                    };

                                    // Append to response
                                    asset.dailyRatios.push(newItem);
                                    console.log(`[Proxy] Patched live ratio for ${assetKey}: ${liveAssetData.currentRatio}`);

                                    // Update Local Cache
                                    if (!localCache[assetKey]) localCache[assetKey] = [];

                                    // Add to cache if not exists for today
                                    const existsInCache = localCache[assetKey].some(r => r.date.split('T')[0] === todayStr);
                                    if (!existsInCache) {
                                        localCache[assetKey].push(newItem);
                                        cacheUpdated = true;
                                    }
                                }
                            }
                        }
                    }
                }

                if (cacheUpdated) {
                    await saveBlobCache(localCache);
                    console.log('[Proxy] Blob cache updated.');
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Proxy Request Failed' }));
        }
        return;
    }

    // PRICE PROXY
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/api/price-history') {
        const coinId = parsedUrl.query.coin;
        const currency = parsedUrl.query.currency || 'usd';
        const from = parsedUrl.query.from;
        const to = parsedUrl.query.to;

        if (!coinId) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing parameters' }));
            return;
        }

        try {
            let finalData;

            if (currency === 'ada') {
                // Fetch Both
                console.log(`[Proxy] Fetching Synthetic ADA rate for ${coinId}`);
                const [targetData, baseData] = await Promise.all([
                    getCoinData(coinId),
                    getCoinData('cardano')
                ]);
                finalData = computeCrossRate(targetData, baseData);
            } else {
                // Fetch Just Target (USD)
                finalData = await getCoinData(coinId);
            }

            // Client-side filtering logic
            if (from && to && finalData.prices) {
                const isFromMs = from.length === 13;
                const isToMs = to.length === 13;
                const fromTime = isFromMs ? parseInt(from) : parseInt(from) * 1000;
                const toTime = isToMs ? parseInt(to) : parseInt(to) * 1000;

                const filteredPrices = finalData.prices.filter(p => p[0] >= fromTime && p[0] <= toTime);
                finalData = { ...finalData, prices: filteredPrices };
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(finalData));

        } catch (e) {
            console.error(e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
};
