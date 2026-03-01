const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, 'bot/logs/execution_analytics.json');

try {
    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '[]');
    }
    
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    
    // Add a synthetic successful trade
    data.push({
        id: Date.now(),
        timestamp_utc: new Date().toISOString(),
        opportunity_id: 'WETH->USDC (Synthetic Pillar 6)',
        block_simulated: 1000000,
        block_targeted: 1000001,
        block_included: 1000001,
        token_in: 'WETH',
        token_out: 'USDC',
        route_hash: 'SYNTH-001',
        borrow_size_usd: 100,
        simulated_profit_usd: 1.50,
        real_profit_usd: 1.48,
        simulated_gas_used: 150000,
        real_gas_used: 152000,
        simulated_base_fee_gwei: 0.1,
        real_base_fee_gwei: 0.1,
        max_priority_fee_gwei: 0.05,
        priority_fee_paid_gwei: 0.05,
        inclusion_delta: 0,
        fork_passed: true,
        live_submitted: true,
        live_success: true,
        dropped_reason: null
    });

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log('[Mock] Synthetic trade injected successfully.');
} catch (e) {
    console.error('[Mock] Failed:', e.message);
}
