const https = require('https');

const CG_API_KEY = 'CG-zdXqbkDWtCUhFgwBBAkXDwBv';
const coinId = 'snek';
const currency = 'ada';
const days = '365';

const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${currency}&days=${days}`;

console.log(`Fetching: ${url}`);

const options = {
    headers: {
        'User-Agent': 'Mozilla/5.0/Vercel',
        'Accept': 'application/json',
        'x-cg-demo-api-key': CG_API_KEY
    }
};

https.get(url, options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => console.log('Body:', data));
}).on('error', e => console.error(e));
