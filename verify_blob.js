require('dotenv').config();
const { list } = require('@vercel/blob');

async function check() {
    console.log('Checking Blobs...');
    try {
        const { blobs } = await list();
        console.log('Blobs found:', blobs.length);
        blobs.forEach(b => console.log(' - ' + b.pathname));

        const cache = blobs.find(b => b.pathname === 'ratios-cache.json');
        if (cache) {
            console.log('SUCCESS: ratios-cache.json exists!');
            console.log('URL:', cache.url);
        } else {
            console.log('FAILURE: ratios-cache.json not found.');
        }
    } catch (e) {
        console.error('Error listing blobs:', e);
    }
}

check();
