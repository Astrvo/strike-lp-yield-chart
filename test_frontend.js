// Native Fetch (Node 18+)
async function testFetch() {
    try {
        console.log('Fetching /api/ratios...');
        const res = await fetch('http://localhost:3000/api/ratios');

        if (!res.ok) {
            console.log(`Failed: ${res.status} ${res.statusText}`);
            return;
        }

        const data = await res.json();
        console.log('Success! Data keys:', Object.keys(data));
        if (data.data) {
            console.log('data.data keys:', Object.keys(data.data));
            if (data.data.assets) console.log('data.data.assets found!');
        }
        if (data.assets) {
            console.log('Assets found:', Object.keys(data.assets));
        } else {
            console.log('WARNING: No assets in root');
        }

    } catch (e) {
        console.error('Fetch Error:', e);
    }
}

testFetch();
