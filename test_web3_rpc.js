const { Web3 } = require('web3');

const web3 = new Web3("https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/");

async function fetchBlockNumber() {
    try {
        console.log('🚀 Connecting to RPC with Web3.js...');
        const currentBlockNumber = await web3.eth.getBlockNumber();
        console.log('✅ Current block number:', currentBlockNumber.toString());
    } catch (error) {
        console.error('❌ Error fetching block number:', error);
    }
}

fetchBlockNumber();
