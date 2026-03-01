try {
    console.log('[Test] Loading viem...');
    const viem = require('viem');
    console.log('[Test] viem OK');
    process.exit(0);
} catch (e) {
    console.error('[Test] FAILED:', e);
    process.exit(1);
}
