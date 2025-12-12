const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 3000;
const API_URL = 'https://app.strikefinance.org/api/perpetuals/getHistoricalRatios';
const CG_API_KEY = 'CG-zdXqbkDWtCUhFgwBBAkXDwBv'; // User provided key

// In-memory cache for Price History
const PRICE_CACHE = {};

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
};

const server = http.createServer((req, res) => {
    console.log(`Request: ${req.url}`);

    // Proxy Endpoint
    if (req.url === '/api/ratios') {
        https.get(API_URL, (apiRes) => {
            let data = '';
            apiRes.on('data', (chunk) => {
                data += chunk;
            });
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

    // Proxy CoinGecko (Price History)
    if (req.url.startsWith('/api/price-history')) {
        console.log(`[Proxy] Received request: ${req.url}`);
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const coinId = urlParams.get('coin');
        let from = urlParams.get('from');
        let to = urlParams.get('to');

        if (!coinId) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing parameters' }));
            return;
        }

        // --- CACHE LOGIC ---
        const CACHE_DURATION = 60 * 60 * 1000; // 1 Hour
        const now = Date.now();

        // Helper to filter and send data
        const sendFilteredResponse = (fullData) => {
            let result = fullData;

            // If from/to are provided, filter the prices array
            if (from && to && fullData.prices) {
                // CoinGecko API returns timestamps in milliseconds.
                // Query params 'from' and 'to' are often in seconds.
                // We need to handle both cases.

                // Check if 'from' parameter is already in milliseconds (13 digits)
                const isFromMs = from.length === 13;
                const isToMs = to.length === 13;

                const fromTime = isFromMs ? parseInt(from) : parseInt(from) * 1000;
                const toTime = isToMs ? parseInt(to) : parseInt(to) * 1000;

                const filteredPrices = fullData.prices.filter(p => p[0] >= fromTime && p[0] <= toTime);

                // Construct new object to avoid mutating cache
                result = {
                    ...fullData,
                    prices: filteredPrices
                };
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
            // Always fetch MAX (or 365 fallback) to populate cache
            const coingeckoUrl = `https://api.coingecko.com/api/v3/coins/${cId}/market_chart?vs_currency=usd&days=${dParam}`;
            console.log(`[Proxy] Fetching for cache: ${coingeckoUrl}`);

            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json',
                    'x-cg-demo-api-key': CG_API_KEY
                }
            };

            https.get(coingeckoUrl, options, (apiRes) => {
                console.log(`[Proxy] Status: ${apiRes.statusCode}`);

                // Fallback Logic
                if (apiRes.statusCode === 401 && dParam === 'max') {
                    console.log('[Proxy] 401 on MAX. Retrying with 365...');
                    apiRes.resume(); // Consume data to prevent connection issues
                    fetchCoinGecko(cId, '365');
                    return;
                }

                let data = '';
                apiRes.on('data', (chunk) => { data += chunk; });
                apiRes.on('end', () => {
                    if (apiRes.statusCode === 200) {
                        try {
                            const parsedData = JSON.parse(data);
                            // Store in Cache
                            PRICE_CACHE[coinId] = {
                                timestamp: Date.now(),
                                data: parsedData
                            };
                            console.log(`[Proxy] Cached ${coinId} data.`);
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

        // Initial fetch: Try MAX first
        fetchCoinGecko(coinId, 'max');
        return;
    }

    // Static File Serving
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = path.extname(filePath);
    let contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404);
                res.end('404 Not Found');
            }
            else {
                res.writeHead(500);
                res.end('500 Internal Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Proxy endpoint available at http://localhost:${PORT}/api/ratios`);
});
