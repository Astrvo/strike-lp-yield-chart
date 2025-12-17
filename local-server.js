require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const apiHandler = require('./api/index');

const PORT = 3000;

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
    // API Routes -> Handled by the Vercel Serverless Function logic
    if (req.url.startsWith('/api')) {
        return apiHandler(req, res);
    }

    // Static Files -> Served from public/ folder
    let filePath = './public' + req.url;
    if (req.url === '/') {
        filePath = './public/index.html';
    }

    const extname = path.extname(filePath);
    let contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404);
                res.end('404 Not Found');
            } else {
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
    console.log(`Local wrapper running at http://localhost:${PORT}/`);
    console.log(`- Frontend: http://localhost:${PORT}/`);
    console.log(`- API Proxy: http://localhost:${PORT}/api/ratios`);
});
