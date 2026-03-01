const { AnalyticsLogger } = require('../bot/analyticsLogger');

async function seedDatabase() {
  console.log('🌱 Seeding Maggie Analytics DB with synthetic execution traces...');
  const logger = new AnalyticsLogger();

  const routes = ['WETH->USDC', 'USDC->WETH', 'DAI->USDC', 'WETH->LINK'];
  
  let baseTimestamp = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
  
  for (let i = 0; i < 50; i++) {
    const isSuccess = Math.random() > 0.2; // 80% win rate
    const isFloorDrop = !isSuccess && Math.random() > 0.5; // Half of failures are drops
    
    // Simulate slight alpha leak over time (sim drift down)
    const driftFactor = 1 - (i * 0.005);
    
    const simProfit = (Math.random() * 5 + 0.5); // $0.5 to $5.5
    const realProfit = isSuccess ? (simProfit * driftFactor) * (0.8 + Math.random() * 0.4) : 0; // +/- 20% variance with drift
    
    const simGas = 150000 + Math.floor(Math.random() * 20000);
    const realGas = isSuccess ? simGas + Math.floor(Math.random() * 10000) : 0; // Real gas slightly higher
    
    const targetBlock = 42700000 + i * 12;
    // 0 = same block, 1 = next block, 2 = 2 blocks late
    let inclusionDelta = 0;
    if (Math.random() > 0.6) inclusionDelta = 1;
    if (Math.random() > 0.9) inclusionDelta = 2;

    const data = {
      timestamp: new Date(baseTimestamp).toISOString(),
      route: routes[Math.floor(Math.random() * routes.length)],
      simulatedBlock: targetBlock - 1,
      targetedBlock: targetBlock,
      inclusionBlock: isSuccess ? targetBlock + inclusionDelta : 0,
      simulatedBaseFeeWei: (10 + Math.random() * 5) * 1e9,
      realBaseFeeWei: isSuccess ? (11 + Math.random() * 6) * 1e9 : 0,
      simulatedGasUsed: simGas,
      realGasUsed: realGas,
      simulatedProfitUsd: simProfit,
      realProfitUsd: realProfit,
      bidPriorityFeeWei: (2 + Math.random() * 1) * 1e9,
      priorityFeePaidWei: isSuccess ? (1.5 + Math.random() * 1.5) * 1e9 : 0,
      wasIncluded: isSuccess,
      reason: isSuccess ? "Test completed successfully" : (isFloorDrop ? "Net profit $0.05 < 3x gas cost" : "execution reverted (unknown custom error)")
    };

    logger.logOpportunity(data);
    baseTimestamp += (30 * 60 * 1000); // add 30 mins between trades
  }
  
  console.log('✅ Injected 50 synthetic execution cycles into SQLite.');
}

seedDatabase();
