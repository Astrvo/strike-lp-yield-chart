const https = require('https');
const url = require('url');

const API_URL = 'https://app.strikefinance.org/api/perpetuals/getHistoricalRatios';
const CG_API_KEY = 'CG-zdXqbkDWtCUhFgwBBAkXDwBv';

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
            const data = await httpsGet(API_URL);

            // SANITIZATION LOGIC AND FILTERING
            if (data && data.success && data.data && data.data.assets) {
                Object.keys(data.data.assets).forEach(assetKey => {
                    const asset = data.data.assets[assetKey];
                    if (asset.dailyRatios && Array.isArray(asset.dailyRatios)) {
                        // Remove trailing entries where ratio is exactly 1 (invalid/default)
                        // Iterate backwards
                        let i = asset.dailyRatios.length - 1;
                        while (i >= 0 && asset.dailyRatios[i].ratio === 1) {
                            i--;
                        }
                        // If we found any valid data, slice everything after it
                        if (i < asset.dailyRatios.length - 1) {
                            asset.dailyRatios = asset.dailyRatios.slice(0, i + 1);
                        }
                    }
                });
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
