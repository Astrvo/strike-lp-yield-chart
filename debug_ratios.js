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

            if (!assetData) {
                console.log(`No data for ${asset}`);
                return;
            }

            if (assetData.dailyRatios) {
                console.log(`Total Ratios for ${asset}: ${assetData.dailyRatios.length}`);
                const slice = assetData.dailyRatios.slice(-10);
                console.log('Last 10 Ratios:');
                console.log(JSON.stringify(slice, null, 2));

                // Check if they are all 1
                const allOnes = slice.every(r => r.ratio === 1);
                console.log(`Are last 10 ratios all 1? ${allOnes}`);
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
