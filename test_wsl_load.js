try {
    console.log('[Test] Loading AnalyticsLogger...');
    const { AnalyticsLogger } = require('./bot/analyticsLogger.js');
    const logger = new AnalyticsLogger();
    console.log('[Test] AnalyticsLogger OK');

    console.log('[Test] Loading PriceMonitor...');
    const { PriceMonitor } = require('./bot/priceMonitor.js');
    console.log('[Test] PriceMonitor OK');

    console.log('[Test] Initializing PriceMonitor...');
    const pm = new PriceMonitor();
    console.log('[Test] PriceMonitor Instance OK');

    process.exit(0);
} catch (e) {
    console.error('[Test] FAILED:', e);
    process.exit(1);
}
