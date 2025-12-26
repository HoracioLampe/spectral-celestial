const https = require('https');

const data = JSON.stringify({
    method: "eth_blockNumber",
    params: [],
    id: 1,
    jsonrpc: "2.0"
});

const options = {
    hostname: 'dawn-palpable-telescope.matic.quiknode.pro',
    path: '/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    let responseBody = '';
    res.on('data', (d) => {
        responseBody += d;
    });
    res.on('end', () => {
        console.log('Response:', responseBody);
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(data);
req.end();
