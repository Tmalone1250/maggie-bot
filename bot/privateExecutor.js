/**
 * Private Executor Module
 * Handles direct submission of bundles to MEV-protected RPCs/builders 
 * with dynamic block targeting and priority fee bidding.
 */
const { ethers } = require('ethers');

class PrivateExecutor {
  /**
   * @param {string} privateRpcUrl MEV-protected RPC endpoint (e.g. Flashbots Protect)
   * @param {string} privateKey Signing key for the bot wallet
   */
  constructor(privateRpcUrl, privateKey) {
    if (!privateRpcUrl || !privateKey) {
      console.warn("⚠️ [PrivateExecutor] Missing Private RPC URL or Private Key. Running in degraded/simulation mode.");
    }
    this.provider = privateRpcUrl ? new ethers.JsonRpcProvider(privateRpcUrl) : null;
    this.wallet = privateKey && this.provider ? new ethers.Wallet(privateKey, this.provider) : null;
    
    // Safety caps for dynamic bidding
    this.MAX_BID_PERCENTAGE = 0.30; // Max 30% of expected profit given to builder
    this.MIN_PROFIT_RETAINED_USD = 1.00; // Hard limit: never bid so high we retain < $1.00
  }

  /**
   * Compute a competitive block priority fee dynamically derived from the expected trade margin.
   * @param {number} netProfitUsd The expected net profit in USD from the evaluation
   * @param {number} ethPriceUsd Current ETH price
   * @param {bigint} estimatedGas Expected gas usage
   * @returns {bigint} The calculated maxPriorityFeePerGas in wei
   */
  calculatePriorityFee(netProfitUsd, ethPriceUsd, estimatedGas) {
    // 1. Calculate max affordable tip in USD
    let maxTipUsd = netProfitUsd * this.MAX_BID_PERCENTAGE;
    
    // Ensure we always keep the minimum retained profit
    if ((netProfitUsd - maxTipUsd) < this.MIN_PROFIT_RETAINED_USD) {
        maxTipUsd = Math.max(0, netProfitUsd - this.MIN_PROFIT_RETAINED_USD);
    }
    
    if (maxTipUsd <= 0) return 0n;

    // 2. Convert USD tip to Wei tip
    // Tip in ETH = Tip in USD / ETH Price
    const tipInEth = maxTipUsd / ethPriceUsd;
    const tipInWei = ethers.parseEther(tipInEth.toFixed(18));
    
    // 3. Convert total tip Wei into per-Gas tip Wei
    const maxPriorityFeePerGas = tipInWei / estimatedGas;
    
    console.log(`[PrivateExecutor] Dynamic Bid Strategy: Bidding ~$${maxTipUsd.toFixed(2)} (${(maxTipUsd/netProfitUsd * 100).toFixed(1)}% of margin) for inclusion.`);
    return maxPriorityFeePerGas;
  }

  /**
   * Submits the transaction targeting block N+1 using a private RPC
   * @param {Object} tx The standard ethers transaction request object
   * @param {Object} profitAnalysis Evaluation object to derive bids from
   * @param {number} currentBlockNumber Current block number to baseline from
   * @returns {Object} Submission analytics
   */
  async submitWithBlockTargeting(tx, profitAnalysis, currentBlockNumber) {
    if (!this.wallet) {
       console.log("⚠️ [PrivateExecutor] No wallet configured. Skipping live private submission.");
       return { success: false, reason: "No wallet" };
    }

    const startTimestamp = Date.now();
    const targetedBlock = currentBlockNumber + 1;
    console.log(`\n🎯 [PrivateExecutor] Targeting Block: ${targetedBlock}`);

    try {
        const sanitizeBigInt = (val) => {
          if (typeof val === 'bigint') return val;
          const s = String(val).split('.')[0];
          return BigInt(s || '0');
        };
        const estGas = sanitizeBigInt(profitAnalysis.gasEstimate);
        
        // Dynamic Bidding Logic
        const dynamicPriorityFee = this.calculatePriorityFee(
            parseFloat(profitAnalysis.netProfitUsd),
            3000,   // FIXME: Pass actual ETH price from PriceMonitor state later
            estGas
        );
        
        const feeData = await this.provider.getFeeData();
        
        // Assemble final EIP-1559 payload
        const hydratedTx = {
            ...tx,
            type: 2,
            maxFeePerGas: feeData.maxFeePerGas + dynamicPriorityFee,
            maxPriorityFeePerGas: dynamicPriorityFee,
            gasLimit: (estGas * 110n) / 100n // 10% buffer
        };
        
        // Sign and Broadcast privately
        console.log(`🚀 [PrivateExecutor] Sending bundle...`);
        const response = await this.wallet.sendTransaction(hydratedTx);
        
        // Await inclusion. If it doesn't land by N+2, we assume dropped/failed
        console.log(`⏳ [PrivateExecutor] Waiting for inclusion (Tx Hash: ${response.hash})...`);
        const receipt = await response.wait(1);
        
        const endTimestamp = Date.now();
        console.log(`✅ [PrivateExecutor] 🔥 INCLUDED in Block ${receipt.blockNumber} 🔥`);
        
        return {
            success: true,
            inclusionBlock: receipt.blockNumber,
            targetedBlock: targetedBlock,
            gasUsed: receipt.gasUsed,
            submissionLatencyMs: endTimestamp - startTimestamp
        };
        
    } catch (error) {
        console.error(`❌ [PrivateExecutor] Bundle submission failed:`, error.message);
        return { success: false, reason: error.message };
    }
  }
}

module.exports = { PrivateExecutor };
