const WebSocket = require('ws');

const wsUrl = "wss://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";

console.log(`🚀 Testing WebSocket: ${wsUrl}`);

const ws = new WebSocket(wsUrl);

ws.on('open', function open() {
    console.log('✅ WebSocket connected');
    ws.send(JSON.stringify({
        "jsonrpc": "2.0",
        "method": "eth_blockNumber",
        "params": [],
        "id": 1
    }));
});

ws.on('message', function incoming(data) {
    console.log('📦 WebSocket response:', data.toString());
    ws.close();
});

ws.on('error', function error(err) {
    console.error('❌ WebSocket error:', err);
});

ws.on('close', function close() {
    console.log('👋 WebSocket closed');
});

// Timeout after 10s
setTimeout(() => {
    if (ws.readyState !== WebSocket.CLOSED) {
        console.log('⏰ Test timed out');
        ws.terminate();
    }
}, 10000);
