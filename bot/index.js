/**
 * Maggie MEV Bot - Main Controller
 * Flashloan Arbitrage Bot for Base Mainnet
 */
require('dotenv').config();
const { AnalyticsLogger } = require('./analyticsLogger'); // Native module early load for stability

const { ethers } = require('ethers');
const { PriceMonitor } = require('./priceMonitor');
const { OpportunityDetector } = require('./opportunityDetector');
const { CalldataEncoder } = require('./calldataEncoder');
const { ForkSimulator } = require('./forkSimulator');
const { PrivateExecutor } = require('./privateExecutor');
const {
  TOKENS,
  MONITORED_PAIRS,
  POLL_INTERVAL_MS,
  PROFIT_VAULT,
  SAFETY,
  BASE_RPC_URL,
  ANVIL_RPC_URL,
  PRIVATE_RPC_URL
} = require('./config');

/**
 * @class MaggieBot
 * @description Main MEV arbitrage controller
 */
class MaggieBot {
  constructor(options = {}) {
    this.useAnvil = options.useAnvil || false;
    this.executorAddress = options.executorAddress || null;
    this.dryRun = options.dryRun !== false; // Default to dry-run mode
    
    // Pillar 4: Initialize persistent Analytics Logger first for native stability
    this.analyticsLogger = new AnalyticsLogger();
    this.priceMonitor = new PriceMonitor(this.useAnvil);
    
    // Wipe diagnostic math logs on boot to ensure clean analysis curves
    try {
        const fs = require('fs');
        if (fs.existsSync('math_dump.txt')) fs.unlinkSync('math_dump.txt');
        if (fs.existsSync('bot_output.log')) fs.unlinkSync('bot_output.log');
    } catch(e) {}
    
    this.opportunityDetector = new OpportunityDetector({
      minProfitUsd: options.minProfitUsd || SAFETY.MIN_PROFIT_USD,
      maxSlippageBps: options.maxSlippageBps || SAFETY.MAX_SLIPPAGE_BPS,
      ethPriceUsd: options.ethPriceUsd || 3000,
    });
    
    // Sync shared price context across modules
    this.priceMonitor.setEthPrice(this.opportunityDetector.ethPriceUsd);
    
    if (this.executorAddress) {
      this.calldataEncoder = new CalldataEncoder(this.executorAddress);
    }
    
    // Initialize provider for simulation
    const rpcUrl = this.useAnvil ? ANVIL_RPC_URL : BASE_RPC_URL;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    // State
    this.isRunning = false;
    this.stats = {
      cyclesCompleted: 0,
      opportunitiesFound: 0,
      viableOpportunities: 0,
      executedTrades: 0,
      totalProfit: 0,
    };
    
    // Pillar 3: Initialize deterministic Execution Layer Mastery simulation Sandbox
    this.forkSimulator = new ForkSimulator({ rpcUrl: rpcUrl, port: 8546 });
    
    // Pillar 3 Phase 2: Initialize Private Submission relay
    this.privateExecutor = new PrivateExecutor(
      PRIVATE_RPC_URL,
      process.env.BOT_PRIVATE_KEY
    );
    
    // Fire Controller (Throttle State)
    this.throttle = {
      maxAttemptsPerBlock: 3,
      attemptsThisBlock: 0,
      currentBlockNumber: 0,
      maxGasPerMinute: 2000000,
      gasUsedThisMinute: 0,
      minuteStartTime: Date.now(),
      consecutiveFailures: 0,
      maxConsecutiveFailures: 3,
      backoffEndTime: 0,
    };
  }

  /**
   * Log startup banner
   */
  logBanner() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                  🧲 MAGGIE MEV BOT 🧲                          ║');
    console.log('║            Flashloan Arbitrage on Base Mainnet                ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║ Mode: ${this.dryRun ? '🔍 DRY-RUN (Simulation Only)' : '🚀 LIVE EXECUTION'}           ║`);
    console.log(`║ Network: ${this.useAnvil ? 'Anvil Fork' : 'Base Mainnet'}                              ║`);
    console.log(`║ Min Profit: $${SAFETY.MIN_PROFIT_USD}                                        ║`);
    console.log(`║ Max Slippage: ${SAFETY.MAX_SLIPPAGE_BPS / 100}%                                          ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  }

  /**
   * Run a single monitoring cycle
   */
  async runCycle() {
    if (Date.now() < this.throttle.backoffEndTime) {
      console.log('⏳ Bot is in temporary backoff period due to consecutive failures. Skipping cycle.');
      return;
    }
    
    if (Date.now() - this.throttle.minuteStartTime > 60000) {
      this.throttle.gasUsedThisMinute = 0;
      this.throttle.minuteStartTime = Date.now();
    }
    
    try {
      const blockNumber = await this.provider.getBlockNumber();
      if (blockNumber > this.throttle.currentBlockNumber) {
        this.throttle.currentBlockNumber = blockNumber;
        this.throttle.attemptsThisBlock = 0;
      }
    } catch (e) {
      console.warn('Failed to fetch block number:', e.message);
    }

    console.log(`\n🔄 Cycle #${this.stats.cyclesCompleted + 1} - ${new Date().toISOString()}`);
    console.log('─'.repeat(60));
    
    for (const pair of MONITORED_PAIRS) {
      try {
        const { prices, opportunities } = await this.priceMonitor.monitorPair(
          pair.token0,
          pair.token1
        );
        
        if (opportunities.length === 0) continue;
        
        this.stats.opportunitiesFound += opportunities.length;
        
        for (const opp of opportunities) {
          const evaluation = this.opportunityDetector.evaluate(opp);
          this.opportunityDetector.logEvaluation(evaluation);
          
          if (evaluation.shouldExecute) {
            this.stats.viableOpportunities++;
            
            if (this.throttle.attemptsThisBlock >= this.throttle.maxAttemptsPerBlock) continue;
            if (this.throttle.gasUsedThisMinute >= this.throttle.maxGasPerMinute) continue;

            if (this.calldataEncoder) {
              const tx = this.calldataEncoder.buildExecutionTransaction(
                opp,
                evaluation.sizing,
                evaluation.profitAnalysis
              );
              this.calldataEncoder.logTransaction(tx);
              
              if (!this.dryRun) {
                console.log('\n🧪 Forking state to simulate transaction...');
                try {
                  const simResult = await this.forkSimulator.simulateAtNextBlock(tx, 1.15);
                  
                  if (simResult.reverted) {
                      throw new Error(`Simulation reverted: ${simResult.error}`);
                  }
                  
                  console.log(`✅ Simulation success! Gas: ${simResult.gasUsed.toString()}`);
                  
                  const analyticsPayload = {
                     timestamp: new Date().toISOString(),
                     route: opp.route.map(t => t.symbol).join('->'),
                     simulatedBlock: this.throttle.currentBlockNumber,
                     targetedBlock: this.throttle.currentBlockNumber + 1,
                     simulatedGasUsed: simResult.gasUsed.toString(),
                     simulatedProfitUsd: evaluation.profitAnalysis.netProfitUsd,
                  };
                  
                  this.throttle.attemptsThisBlock++;
                  this.throttle.gasUsedThisMinute += tx.gasLimit;
                  this.throttle.consecutiveFailures = 0;
                  
                  console.log('\n🚀 Proceeding to Private RPC Submission');
                  const executionResult = await this.privateExecutor.submitWithBlockTargeting(
                      tx, 
                      evaluation.profitAnalysis, 
                      this.throttle.currentBlockNumber
                  );
                  
                  if (executionResult.success) {
                     this.stats.executedTrades++;
                     this.stats.totalProfit += parseFloat(evaluation.profitAnalysis.netProfitAfterGas); 
                     analyticsPayload.wasIncluded = true;
                     analyticsPayload.inclusionBlock = executionResult.inclusionBlock;
                     analyticsPayload.realGasUsed = executionResult.gasUsed.toString();
                     this.analyticsLogger.logOpportunity(analyticsPayload);
                  } else {
                     console.warn(`[Execution Dropped] Reason: ${executionResult.reason}`);
                     this.throttle.backoffEndTime = Date.now() + 5000;
                     analyticsPayload.wasIncluded = false;
                     this.analyticsLogger.logOpportunity(analyticsPayload);
                  }
                  
                } catch (err) {
                  console.error('❌ Simulation Error:', err.message);
                  this.throttle.consecutiveFailures++;
                  if (this.throttle.consecutiveFailures >= this.throttle.maxConsecutiveFailures) {
                      this.throttle.backoffEndTime = Date.now() + 15000;
                  }
                }
              } else {
                console.log('\n📝 DRY-RUN: Simulation only');
                this.stats.executedTrades++;
                this.stats.totalProfit += parseFloat(evaluation.profitAnalysis.netProfitAfterGas);
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error monitoring ${pair.name}:`, err.message);
      }
    }
    this.stats.cyclesCompleted++;
  }

  logStats() {
    console.log('\n📊 Session Statistics');
    console.log('═'.repeat(40));
    console.log(`Cycles Completed: ${this.stats.cyclesCompleted}`);
    console.log(`Opportunities Found: ${this.stats.opportunitiesFound}`);
    console.log(`Viable Opportunities: ${this.stats.viableOpportunities}`);
    console.log(`Total Profit (Estimated): $${this.stats.totalProfit.toFixed(4)}`);
    console.log('═'.repeat(40));
  }

  async start(maxCycles = 0) {
    this.logBanner();
    this.isRunning = true;
    await this.forkSimulator.start();
    
    console.log('🚀 Starting monitoring...\n');
    let cycles = 0;
    while (this.isRunning) {
      await this.runCycle();
      cycles++;
      if (maxCycles > 0 && cycles >= maxCycles) break;
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    this.logStats();
  }

  stop() {
    this.isRunning = false;
    if (this.forkSimulator) this.forkSimulator.stop();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useAnvil = args.includes('--anvil') || args.includes('-a');
  const bot = new MaggieBot({
    useAnvil,
    dryRun: true,
    executorAddress: process.env.EXECUTOR_ADDRESS || null,
  });
  
  process.on('SIGINT', () => {
    bot.stop();
    process.exit(0);
  });
  
  await bot.start();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { MaggieBot };
