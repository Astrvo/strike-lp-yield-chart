const http = require('http');

console.log('Fetching /api/ratios from localhost:3000...');

http.get('http://localhost:3000/api/ratios', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (!json.success || !json.data || !json.data.assets) {
                console.error('Invalid JSON structure:', Object.keys(json));
                return;
            }

            const asset = 'SNEK'; // Default asset
            const assetData = json.data.assets[asset];

            if (assetData.dailyRatios) {
                console.log(`Total Ratios for ${asset}: ${assetData.dailyRatios.length}`);
                const last = assetData.dailyRatios[assetData.dailyRatios.length - 1];
                console.log('Last Ratio:', JSON.stringify(last, null, 2));

                const today = new Date().toISOString().split('T')[0];
                const lastDate = last.date.split('T')[0];
                console.log(`Is last date today (${today})? ${lastDate === today}`);
                console.log(`Is ratio != 1? ${last.ratio !== 1}`);
            } else {
                console.log('No dailyRatios found.');
            }

        } catch (e) {
            console.error('Parse error:', e);
            console.log('Raw data preview:', data.substring(0, 200));
        }
    });
}).on('error', err => {
    console.error('Request failed:', err.message);
});
