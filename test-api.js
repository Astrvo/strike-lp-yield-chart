const handler = require('./api/index');
const http = require('http');

// Mock Request and Response
const req = {
    url: '/api/price-history?coin=snek&currency=ada&days=1',
    method: 'GET'
};

const res = {
    setHeader: (k, v) => console.log(`Header: ${k}=${v}`),
    writeHead: (code, headers) => console.log(`Status: ${code}`),
    end: (data) => console.log('Body:', data ? data.substring(0, 100) + '...' : 'No Data')
};

console.log('Testing handler...');
handler(req, res);
