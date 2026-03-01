/**
 * Analytics Logger Module (Pillar 5 Compatibility Upgrade)
 * Logs opportunity lifecycle data into a JSON file for maximum stability in WSL.
 */
const fs = require('fs');
const path = require('path');

class AnalyticsLogger {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    this.dbFile = path.join(this.logDir, 'execution_analytics.json');
    this.ensureLogDirExists();
    console.log(`[AnalyticsLogger] Initializing stable JSON logger at: ${this.dbFile}`);
    
    // Initialize the file if it doesn't exist
    if (!fs.existsSync(this.dbFile)) {
      fs.writeFileSync(this.dbFile, JSON.stringify([], null, 2));
    }
  }

  ensureLogDirExists() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Log a completed or failed opportunity lifecycle
   * @param {Object} data The analytics tracking payload 
   */
  logOpportunity(data) {
    try {
      const payload = {
        id: Date.now(),
        timestamp_utc: data.timestamp || new Date().toISOString(),
        opportunity_id: data.route || 'Unknown', 
        block_simulated: data.simulatedBlock || 0,
        block_targeted: data.targetedBlock || 0,
        block_included: data.inclusionBlock || 0,
        token_in: data.route ? data.route.split('->')[0] : 'Unknown',
        token_out: data.route ? data.route.split('->')[1] : 'Unknown',
        route_hash: 'SimulatedTrace',
        borrow_size_usd: parseFloat(data.borrowSizeUsd || 0),
        simulated_profit_usd: parseFloat(data.simulatedProfitUsd || 0),
        real_profit_usd: parseFloat(data.realProfitUsd || 0),
        simulated_gas_used: parseInt(data.simulatedGasUsed || 0),
        real_gas_used: parseInt(data.realGasUsed || 0),
        simulated_base_fee_gwei: parseFloat(data.simulatedBaseFeeWei || 0) / 1e9,
        real_base_fee_gwei: parseFloat(data.realBaseFeeWei || 0) / 1e9,
        max_priority_fee_gwei: parseFloat(data.bidPriorityFeeWei || 0) / 1e9,
        priority_fee_paid_gwei: parseFloat(data.priorityFeePaidWei || 0) / 1e9,
        inclusion_delta: (data.inclusionBlock && data.targetedBlock) ? (data.inclusionBlock - data.targetedBlock) : 0,
        fork_passed: !data.reason || data.reason === "Test completed successfully",
        live_submitted: data.wasIncluded !== undefined,
        live_success: data.wasIncluded,
        dropped_reason: data.reason || null
      };

      // Read current logs
      const currentLogs = JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
      currentLogs.push(payload);
      
      // Keep only last 1000 records to prevent file bloating
      if (currentLogs.length > 1000) currentLogs.shift();
      
      fs.writeFileSync(this.dbFile, JSON.stringify(currentLogs, null, 2));
      console.log(`[AnalyticsLogger] Logged trade to JSON: ${payload.opportunity_id}`);
    } catch (err) {
      console.error('❌ [AnalyticsLogger] Failed to write to JSON log:', err.message);
    }
  }
}

module.exports = { AnalyticsLogger };
