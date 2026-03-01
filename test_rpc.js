const { createPublicClient, http } = require('viem');
const { base } = require('viem/chains');

const client = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
});

const WETH = '0x4200000000000000000000000000000000000006';

async function test() {
    try {
        console.log('[RPC Test] Fetching WETH symbol...');
        const symbol = await client.readContract({
            address: WETH,
            abi: [{ name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] }],
            functionName: 'symbol',
        });
        console.log('[RPC Test] WETH Symbol:', symbol);
        
        console.log('[RPC Test] Fetching current block...');
        const block = await client.getBlockNumber();
        console.log('[RPC Test] Block:', block.toString());
        
        process.exit(0);
    } catch (e) {
        console.error('[RPC Test] FAILED:', e.message);
        process.exit(1);
    }
}

test();
