const https = require('https');
const url = require('url');

const API_URL = 'https://app.strikefinance.org/api/perpetuals/getHistoricalRatios';
const CG_API_KEY = 'CG-zdXqbkDWtCUhFgwBBAkXDwBv';

// In-memory cache for Price History (Note: Serverless functions are ephemeral, so cache might not persist long)
// However, Vercel often reuses warm lambdas, so it's still useful.
const PRICE_CACHE = {};

module.exports = (req, res) => {
    // Enable CORS for all
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    console.log(`Request: ${req.url}`);

    // Proxy Endpoint: Ratio History
    if (req.url === '/api/ratios') {
        https.get(API_URL, (apiRes) => {
            let data = '';
            apiRes.on('data', (chunk) => { data += chunk; });
            apiRes.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
            });
        }).on('error', (err) => {
            console.error(err);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Proxy request failed' }));
        });
        return;
    }

    // Proxy Endpoint: Price History
    // Parse URL manually since Vercel might pass different paths
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/api/price-history') {
        console.log(`[Proxy] Received request: ${req.url}`);
        const coinId = parsedUrl.query.coin;
        const from = parsedUrl.query.from;
        const to = parsedUrl.query.to;
        const days = parsedUrl.query.days;

        if (!coinId) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing parameters' }));
            return;
        }

        // --- CACHE LOGIC ---
        const CACHE_DURATION = 60 * 60 * 1000; // 1 Hour
        const now = Date.now();

        const sendFilteredResponse = (fullData) => {
            let result = fullData;
            if (from && to && fullData.prices) {
                const isFromMs = from.length === 13;
                const isToMs = to.length === 13;
                const fromTime = isFromMs ? parseInt(from) : parseInt(from) * 1000;
                const toTime = isToMs ? parseInt(to) : parseInt(to) * 1000;

                const filteredPrices = fullData.prices.filter(p => p[0] >= fromTime && p[0] <= toTime);
                result = { ...fullData, prices: filteredPrices };
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        };

        if (PRICE_CACHE[coinId] && (now - PRICE_CACHE[coinId].timestamp < CACHE_DURATION)) {
            console.log(`[Proxy] Serving ${coinId} from cache.`);
            sendFilteredResponse(PRICE_CACHE[coinId].data);
            return;
        }
        // -------------------

        const fetchCoinGecko = (cId, dParam) => {
            const coingeckoUrl = `https://api.coingecko.com/api/v3/coins/${cId}/market_chart?vs_currency=usd&days=${dParam}`;
            console.log(`[Proxy] Fetching for cache: ${coingeckoUrl}`);

            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0/Vercel',
                    'Accept': 'application/json',
                    'x-cg-demo-api-key': CG_API_KEY
                }
            };

            https.get(coingeckoUrl, options, (apiRes) => {
                console.log(`[Proxy] Status: ${apiRes.statusCode}`);

                if (apiRes.statusCode === 401 && dParam === 'max') {
                    console.log('[Proxy] 401 on MAX. Retrying with 365...');
                    apiRes.resume();
                    fetchCoinGecko(cId, '365');
                    return;
                }

                let data = '';
                apiRes.on('data', (chunk) => { data += chunk; });
                apiRes.on('end', () => {
                    if (apiRes.statusCode === 200) {
                        try {
                            const parsedData = JSON.parse(data);
                            PRICE_CACHE[coinId] = { timestamp: Date.now(), data: parsedData };
                            sendFilteredResponse(parsedData);
                        } catch (e) {
                            console.error('[Proxy] JSON Parse Error', e);
                            res.writeHead(500);
                            res.end(JSON.stringify({ error: 'Parse error' }));
                        }
                    } else {
                        console.error(`[Proxy] API Error: ${data}`);
                        res.writeHead(apiRes.statusCode);
                        res.end(data);
                    }
                });
            }).on('error', (err) => {
                console.error(`[Proxy] Network Error: ${err.message}`);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Proxy request failed' }));
            });
        };

        fetchCoinGecko(coinId, 'max');
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
};
