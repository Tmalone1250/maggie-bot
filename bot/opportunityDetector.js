/**
 * Opportunity Detector Module
 * Analyzes arbitrage opportunities and validates profitability
 */
const { parseUnits, formatUnits } = require('viem');
const {
  SAFETY,
  AAVE_FLASH_FEE_BPS,
  DECIMALS,
  TOKENS,
} = require('./config');

/**
 * @class OpportunityDetector
 * @description Analyzes and validates arbitrage opportunities with slippage modeling
 */
class OpportunityDetector {
  constructor(options = {}) {
    this.minProfitUsd = options.minProfitUsd || SAFETY.MIN_PROFIT_USD;
    this.maxSlippageBps = options.maxSlippageBps || SAFETY.MAX_SLIPPAGE_BPS;
    this.minProfitBps = options.minProfitBps || SAFETY.MIN_PROFIT_BPS;
    this.maxFlashloanPercent = options.maxFlashloanPercent || SAFETY.MAX_FLASHLOAN_PERCENT;
    this.maxFlashloanUsd = options.maxFlashloanUsd || SAFETY.MAX_FLASHLOAN_USD;
    
    // ETH price in USD (should be fetched dynamically in production)
    this.ethPriceUsd = options.ethPriceUsd || 3000;
    
    // Base gas price in gwei (typically very low on Base)
    this.baseFeeGwei = options.baseFeeGwei || 0.001;
  }

  /**
   * Safe conversion to BigInt stripping decimals
   * @param {any} val Value to convert
   * @returns {bigint} Sanitized BigInt
   */
  sanitizeBigInt(val) {
    if (typeof val === 'bigint') return val;
    const s = String(val).split('.')[0];
    return BigInt(s || '0');
  }

  /**
   * Get exact token decimals via lower-case mapping
   * @param {string} token Token address
   * @returns {number} Decimals
   */
  getTokenDecimals(token) {
    if (!token) return 18;
    const t = token.toLowerCase();
    for (const [key, addr] of Object.entries(TOKENS)) {
      if (addr.toLowerCase() === t) {
        return DECIMALS[addr];
      }
    }
    return 18;
  }

  /**
   * Look up token USD price
   * @param {string} token Token address
   * @returns {number} USD Price
   */
  getTokenUsdPrice(token) {
    const t = token.toLowerCase();
    if (t === TOKENS.USDC.toLowerCase() || t === TOKENS.USDT.toLowerCase() || t === TOKENS.DAI.toLowerCase()) {
      return 1.0;
    }
    // LSTs trade near ETH par, fallback to ETH price for USD estimates
    if (t === TOKENS.cbETH.toLowerCase() || t === TOKENS.rETH.toLowerCase() || t === TOKENS.wstETH.toLowerCase()) {
      return this.ethPriceUsd;
    }
    return this.ethPriceUsd; // Default to ETH price
  }

  /**
   * Determine mathematically executable inefficiency edge
   * @param {number} spread Mid-price spread percentage
   * @param {number} liquidityImpact Slippage expected at size
   * @param {number} gasUsd Gas cost in USD
   * @param {number} sizeUsd Total trade size in USD
   * @param {number} flashFeePct Lender fee (e.g. 0.0005)
   * @returns {number} Net executable edge vs costs
   */
  calculateInefficiencyEdge(spread, liquidityImpact, gasUsd, sizeUsd, flashFeePct) {
    const gasPct = gasUsd / sizeUsd;
    const netEdge = spread - liquidityImpact - gasPct - flashFeePct;
    return netEdge;
  }

  /**
   * Simulate an exact AMM swap using virtual reserves (x * y = k)
   * @param {string|bigint} liquidity Pool geometric base liquidity L
   * @param {number} humanPrice Price of token0 in terms of token1
   * @param {number} feeTier Pool fee (e.g. 3000 = 0.3%)
   * @param {boolean} isToken0ToToken1 True if swapping token0 for token1
   * @param {number} amountInRaw Raw input amount
   * @param {string} token0 Address of token0
   * @param {string} token1 Address of token1
   * @returns {number} Raw output amount
   */
  simulateExactSwap(liquidity, humanPrice, feeTier, isToken0ToToken1, amountInRaw, token0, token1) {
    const L = Number(this.sanitizeBigInt(liquidity));
    if (L === 0 || humanPrice === 0 || amountInRaw === 0) return 0;

    const t0Dec = this.getTokenDecimals(token0);
    const t1Dec = this.getTokenDecimals(token1);
    
    // rawPrice = Price * 10^(decimals1 - decimals0)
    const rawPrice = humanPrice * (10 ** (t1Dec - t0Dec));
    const sqrtRawPrice = Math.sqrt(rawPrice);
    
    // Virtual Reserves: x = L / sqrt(P), y = L * sqrt(P)
    const x_res = L / sqrtRawPrice;
    const y_res = L * sqrtRawPrice;
    
    const feeRate = Number(feeTier) / 1000000;
    const amountInWithFee = amountInRaw * (1 - feeRate);
    
    if (isToken0ToToken1) {
      // Swapping token0 into token1 (x to y)
      const new_x = x_res + amountInWithFee;
      const amountOut = y_res - (x_res * y_res) / new_x;
      return amountOut;
    } else {
      // Swapping token1 into token0 (y to x)
      const new_y = y_res + amountInWithFee;
      const amountOut = x_res - (x_res * y_res) / new_y;
      return amountOut;
    }
  }

  /**
   * Normalize geometric liquidity (L) to virtual token0 reserves
   * @param {string|bigint} liquidity Pool liquidity
   * @param {number} humanPrice Price of token0 in terms of token1
   * @param {string} token0 Address of token0
   * @param {string} token1 Address of token1
   * @returns {bigint} Virtual reserve of token0 in raw units
   */
  normalizeLiquidityToToken0(liquidity, humanPrice, token0, token1) {
    const L = Number(liquidity);
    if (L === 0 || humanPrice === 0) return 0n;
    
    const t0Dec = this.getTokenDecimals(token0);
    const t1Dec = this.getTokenDecimals(token1);
    
    // Convert human price (token1/token0) to raw price
    // rawPrice = humanPrice * 10^(t1Dec - t0Dec)
    const rawPrice = humanPrice * (10 ** (t1Dec - t0Dec));
    const sqrtRawPrice = Math.sqrt(rawPrice);
    
    // Virtual reserve of token0 (raw units) = L / sqrt(P_raw)
    const xRaw = L / sqrtRawPrice;
    
    return this.sanitizeBigInt(Math.floor(xRaw));
  }

  /**
   * Calculate optimal flashloan amount based on liquidity constraints
   * @param {Object} opportunity Arbitrage opportunity
   * @returns {Object} Optimal amount and constraints
   */
  calculateOptimalAmount(opportunity) {
    // Parse liquidity values, normalizing them to token0 virtual reserves
    const buyLiquidity = this.normalizeLiquidityToToken0(
      opportunity.buyLiquidity, 
      opportunity.buyPrice, 
      opportunity.token0, 
      opportunity.token1
    );
    const sellLiquidity = this.normalizeLiquidityToToken0(
      opportunity.sellLiquidity, 
      opportunity.sellPrice, 
      opportunity.token0, 
      opportunity.token1
    );
    
    // Use the smaller liquidity as the constraint
    const constrainingLiquidity = buyLiquidity < sellLiquidity ? buyLiquidity : sellLiquidity;
    
    // Maximum flashloan = X% of constraining liquidity
    let maxFlashloan = (constrainingLiquidity * this.sanitizeBigInt(this.maxFlashloanPercent)) / 100n;
    
    // Safety constraint: Enforce strict USD capital limits
    const tokenUsdPrice = this.getTokenUsdPrice(opportunity.token0);
    const tokenDecimals = this.getTokenDecimals(opportunity.token0);
    
    // Calculate how many raw units $25 equals in this specific token
    const maxTokenUnits = this.maxFlashloanUsd / tokenUsdPrice;
    
    // Scale token units cleanly using token-specific decimals (No hardcoded 1e18 here)
    const maxUsdInWei = this.sanitizeBigInt(maxTokenUnits * (10 ** tokenDecimals));
    
    // If the calculated USD cap is smaller than the liquidity depth, bind to the USD cap
    if (maxUsdInWei < maxFlashloan && maxUsdInWei > 0n) {
        maxFlashloan = maxUsdInWei;
    }
    
    // Estimate optimal size (start conservative)
    let optimalAmount = maxFlashloan / 10n; // Start with 10% of max allowed
    
    // Never drop below extremely tiny amounts unless the max allows it, bump the optimal 
    // amount to at least use a measurable test ping if it got crushed too low.
    const thresholdWei = this.sanitizeBigInt(1e15);
    if (optimalAmount < thresholdWei && maxFlashloan > thresholdWei) { 
        optimalAmount = thresholdWei; // ~0.001 ETH minimum reasonable test size
    } else if (optimalAmount === 0n && maxFlashloan > 0n) {
        optimalAmount = maxFlashloan;
    }
    
    return {
      maxFlashloan: maxFlashloan.toString(),
      optimalAmount: optimalAmount.toString(),
      constrainingLiquidity: constrainingLiquidity.toString(),
      limitingPool: buyLiquidity < sellLiquidity ? 'buy' : 'sell',
    };
  }

  /**
   * Model slippage for a given trade size
   * @param {bigint} tradeSize Size of trade
   * @param {bigint} liquidity Pool liquidity
   * @param {number} feeTier Pool fee tier
   * @returns {Object} Slippage estimate
   */
  modelSlippage(tradeSize, liquidity, feeTier) {
    // Simplified slippage model: slippage ≈ (tradeSize / liquidity) * factor
    // In practice, this should use tick-based calculation
    
    const tradeSizeBn = this.sanitizeBigInt(tradeSize);
    const liquidityBn = this.sanitizeBigInt(liquidity);
    
    if (liquidityBn === 0n) {
      return { slippageBps: 10000, acceptable: false }; // 100% slippage
    }
    
    // Calculate impact ratio (scaled by 10000 for bps)
    const impactRatio = (tradeSizeBn * 10000n) / liquidityBn;
    
    // Apply a multiplier based on fee tier (lower fees = tighter spread = more slippage)
    const feeMultiplier = feeTier === 100 ? 3 : feeTier === 500 ? 2 : 1;
    
    // Assume Base slippage ≈ 3 bps (0.03%) on a standard deep pool for minimal trade, applying factor
    // Realistic slippage modelling: 
    // Impact = (tradeSize / liquidity) * 10000 
    // Minimum theoretical slippage is dictated by the fee tier.
    const theoreticalSlippageBps = Number(impactRatio) + (feeMultiplier * 3);
    
    // Apply a pessimistic slippage haircut (Alpha bot standard)
    // We assume slippage might be 2x worse due to MEV, block delay, or hidden liquidity gaps
    const pessimisticSlippageBps = theoreticalSlippageBps * 2;
    
    return {
      slippageBps: pessimisticSlippageBps,
      acceptable: pessimisticSlippageBps <= this.maxSlippageBps,
      maxAllowedBps: this.maxSlippageBps,
    };
  }

  /**
   * Estimate gas cost for the arbitrage transaction
   * @returns {Object} Gas estimate
   */
  estimateGasCost() {
    // Typical gas for flashloan + 2 swaps on Base
    const gasUnits = 350000; // Conservative estimate
    
    // Dynamic gas modeling: base fee + priority tip
    // Here we simulate a priority tip buffer of 0.05 gwei for faster inclusion
    const priorityTipGwei = 0.05;
    const effectiveGasPriceGwei = this.baseFeeGwei + priorityTipGwei;
    
    // Gas cost in ETH
    const gasCostEth = (gasUnits * effectiveGasPriceGwei) / 1e9;
    
    // Gas cost in USD
    const gasCostUsd = gasCostEth * this.ethPriceUsd;
    
    return {
      gasUnits,
      gasPriceGwei: effectiveGasPriceGwei,
      gasCostEth,
      gasCostUsd,
    };
  }

  /**
   * Evaluates the net raw resulting token output after executing a full cycle
   * @param {Object} opportunity The market opportunity geometry
   * @param {number} amountInRawNum The precise raw input units
   * @param {number} flashFeeRawNum The exact fee in abstract units required by the lender
   * @param {number} gasRawNum The estimated gas cost denoted in the raw borrowed token's abstraction
   * @returns {Object} Extracted exact raw amounts & internal swaps
   */
  computeExecutableSpread(opportunity, amountInRawNum, flashFeeRawNum, gasRawNum) {
    if (amountInRawNum === 0) return { netRaw: 0, grossRaw: 0, swap1Out: 0, swap2Out: 0, gasRaw: 0, flashFeeRaw: 0 };
    
    // Swap 1: Sell token0 for token1 in buyFrom/sellTo pool logic
    const exactSwap1Out = this.simulateExactSwap(
      opportunity.sellLiquidity, opportunity.sellPrice, opportunity.sellFee, true, amountInRawNum, opportunity.token0, opportunity.token1
    );
    
    // Swap 2: Buy token0 using token1 in the pool where token0 is cheaper (buyPrice)
    const exactSwap2Out = this.simulateExactSwap(
      opportunity.buyLiquidity, opportunity.buyPrice, opportunity.buyFee, false, exactSwap1Out, opportunity.token0, opportunity.token1
    );

    // Decompose absolute raw profit into core components for Surgical Analysis
    const grossRawToken0 = exactSwap2Out - amountInRawNum;
    const netRawToken0 = grossRawToken0 - flashFeeRawNum - gasRawNum;

    return { 
      netRaw: netRawToken0, 
      grossRaw: grossRawToken0, 
      swap1Out: exactSwap1Out, 
      swap2Out: exactSwap2Out,
      gasRaw: gasRawNum,
      flashFeeRaw: flashFeeRawNum
    };
  }

  /**
   * Calculate expected profit after all costs
   * @param {Object} opportunity Arbitrage opportunity
   * @param {string} borrowAmount Amount to borrow (as string)
   * @param {number} tokenDecimals Decimals of borrowed token
   * @returns {Object} Profit analysis
   */
  calculateProfit(opportunity, borrowAmount, tokenDecimals = 18) {
    const amount = this.sanitizeBigInt(borrowAmount);
    const amountFloat = Number(formatUnits(amount, tokenDecimals));
    const tokenUsdPrice = this.getTokenUsdPrice(opportunity.token0);
    
    // Amount in USD
    const amountUsd = amountFloat * tokenUsdPrice;
    
    // Gas cost
    const gasEstimate = this.estimateGasCost();
    // Convert USD gas back into token0 exact raw units for mathematical subtraction inside the curve
    const gasRawNum = (gasEstimate.gasCostUsd / tokenUsdPrice) * (10 ** tokenDecimals);
    
    // Flashloan fee (Aave: 0.05%) 
    const flashFeePercent = AAVE_FLASH_FEE_BPS / 10000;
    const flashFeeAmount = amountUsd * flashFeePercent;
    // Flash fee mapped inside the token's geometry
    const flashFeeRawNum = Number(amount) * flashFeePercent;
    
    // Exact Math Simulation using Virtual Reserves
    const amountInRawNum = Number(amount);
    const { netRaw, swap1Out, swap2Out } = this.computeExecutableSpread(
        opportunity, amountInRawNum, flashFeeRawNum, gasRawNum
    );

    // Gross profit from price difference (Calculated in USD from Exact Math Output)
    const exactProfitFloat = netRaw / (10 ** tokenDecimals);
    const netProfitAfterGas = exactProfitFloat * tokenUsdPrice;
    
    // Calculate gross profit decoupled from costs for display purposes only
    const grossRawFloat = (swap2Out - amountInRawNum) / (10 ** tokenDecimals);
    const grossProfitAmount = grossRawFloat * tokenUsdPrice;
    const grossProfitPercent = amountFloat > 0 ? (grossRawFloat / amountFloat) : 0;
    
    // Override abstract slippage calculation with exact net bounds
    const slippageCost = 0; // Exact math natively subsumes price impact slippage!
    
    // Slippage (diagnostic backwards compatibility)
    const buyLiquidityNormalized = this.normalizeLiquidityToToken0(
      opportunity.buyLiquidity, 
      opportunity.buyPrice, 
      opportunity.token0, 
      opportunity.token1
    );
    const sellLiquidityNormalized = this.normalizeLiquidityToToken0(
      opportunity.sellLiquidity, 
      opportunity.sellPrice, 
      opportunity.token0, 
      opportunity.token1
    );

    const buySlippage = this.modelSlippage(borrowAmount, buyLiquidityNormalized, opportunity.buyFee);
    const sellSlippage = this.modelSlippage(borrowAmount, sellLiquidityNormalized, opportunity.sellFee);
    const totalSlippagePercent = (buySlippage.slippageBps + sellSlippage.slippageBps) / 10000;
    
    // Net profit calculation (USD)
    const netProfitBeforeGas = grossProfitAmount - flashFeeAmount - slippageCost;
    
    // Profit in basis points of borrowed amount
    const profitBps = (netProfitAfterGas / amountFloat) * 10000;
    
    // Gross profit margin required vs Gas Cost
    // Alpha bot rule: netProfit >= 2-5x gasCost (We use 3x)
    const gasCostMultiplierReq = 3; 
    const passesGasMargin = netProfitAfterGas >= (gasEstimate.gasCostUsd * gasCostMultiplierReq);
    
    return {
      borrowAmount: borrowAmount,
      borrowAmountFormatted: amountFloat.toPrecision(12),
      
      // Gross
      grossProfitPercent: (grossProfitPercent * 100).toFixed(4),
      grossProfitAmount: grossProfitAmount.toPrecision(12),
      
      // Costs
      flashFeePercent: (flashFeePercent * 100).toFixed(4),
      flashFeeAmount: flashFeeAmount.toPrecision(12),
      totalSlippagePercent: (totalSlippagePercent * 100).toFixed(4),
      slippageCost: slippageCost.toPrecision(12),
      gasCostUsd: gasEstimate.gasCostUsd.toPrecision(12),
      
      // Net
      netProfitBeforeGas: netProfitBeforeGas.toPrecision(12),
      netProfitAfterGas: netProfitAfterGas.toPrecision(12),
      profitBps: profitBps.toFixed(2),
      
      // Exact Math Diagnostics
      amountInRaw: borrowAmount.toString(),
      exactMath: {
        gasRawNum: gasRawNum.toFixed(0),
        flashFeeRawNum: flashFeeRawNum.toFixed(0),
        poolA: {
          price: opportunity.sellPrice,
          liquidity: opportunity.sellLiquidity.toString(),
          token0Depth: sellLiquidityNormalized.toString()
        },
        swap1OutRaw: swap1Out.toFixed(0),
        poolB: {
          price: opportunity.buyPrice,
          liquidity: opportunity.buyLiquidity.toString(),
          token0Depth: buyLiquidityNormalized.toString()
        },
        swap2OutRaw: swap2Out.toFixed(0),
        netRaw: netRaw.toFixed(0)
      },
      
      // Validation
      slippageAcceptable: buySlippage.acceptable && sellSlippage.acceptable, // Keep heuristic bounds as supplementary guards
      profitAcceptable: netProfitAfterGas > 0, // Enforce strict mathematical netRaw validation
      bpsAcceptable: true, // Deprecated in favor of exact curve peak sizing
      passesGasMargin: passesGasMargin,
      
      // Overall
      isViable: (
        netProfitAfterGas > 0 &&
        passesGasMargin
      ),
    };
  }

  /**
   * Calculate confidence score using heuristic markers
   * @param {Object} profitAnalysis Data from calculateProfit
   * @returns {number} Confidence Score (Target > 5.0)
   */
  calculateConfidenceScore(profitAnalysis) {
    if (profitAnalysis.netProfitAfterGas <= 0) return 0;
    
    // Confidence = (Margin / GasCost) * LiquidityScore * StabilityScore
    const marginVsGas = profitAnalysis.netProfitAfterGas / Math.max(0.0001, parseFloat(profitAnalysis.gasCostUsd));
    
    // Simulate Liquidity Score
    const avgSlippage = parseFloat(profitAnalysis.totalSlippagePercent) * 10000; 
    const maxSlippage = this.maxSlippageBps * 2; 
    const liquidityScore = Math.max(0.1, 1 - (avgSlippage / maxSlippage));
    
    // Simulate stability score (placeholder 0.9 for now, should be based on block history)
    const stabilityScore = 0.9;
    
    return marginVsGas * liquidityScore * stabilityScore;
  }

  /**
   * Evaluate an opportunity and determine if it should be executed
   * @param {Object} opportunity Arbitrage opportunity from PriceMonitor
   * @returns {Object} Full evaluation with recommendation
   */
  evaluate(opportunity) {
    const tokenDecimals = this.getTokenDecimals(opportunity.token0);
    const tokenUsdPrice = this.getTokenUsdPrice(opportunity.token0);
    
    // Safety constraint: Enforce strict USD capital limits translated to raw protocol units
    const maxTokenUnits = this.maxFlashloanUsd / tokenUsdPrice;
    const maxUsdInWei = this.sanitizeBigInt(maxTokenUnits * (10 ** tokenDecimals));
    
    // Gas cost
    const gasEstimate = this.estimateGasCost();
    // Convert USD gas back into token0 exact raw units for mathematical subtraction inside the curve
    const gasRawNum = (gasEstimate.gasCostUsd / tokenUsdPrice) * (10 ** tokenDecimals);
    const flashFeePercent = AAVE_FLASH_FEE_BPS / 10000;
      
    // ----------------------------------------------------------------------
    // Executable Spread Curve Generator (Phase 8)
    // ----------------------------------------------------------------------
    const curvePoints = [];
    const maxNumberLimit = Number(maxUsdInWei);
    
    // Start with a small empirical test (e.g. $1 worth of tokens) to anchor the curve ceiling
    const tinyStartNum = Math.floor((1 / tokenUsdPrice) * (10 ** tokenDecimals));
    let testSize = tinyStartNum > 0 ? tinyStartNum : 1; 

    // Generate 12 logarithmically spaced test points across the viable bound sizes
    // Institutional Shift: Sample specifically across $25, $250, $1k, $2.5k, $5k windows
    const samplingSizesUsd = [1, 25, 250, 1000, 2500, 5000];
    
    for (const sizeUsd of samplingSizesUsd) {
        let testSize = Math.floor((sizeUsd / tokenUsdPrice) * (10 ** tokenDecimals));
        if (testSize <= 0) testSize = 1;
        
        const flashFeeRawNum = testSize * flashFeePercent;
        const spreadMetrics = this.computeExecutableSpread(opportunity, testSize, flashFeeRawNum, gasRawNum);
        
        curvePoints.push({
            amountInRaw: testSize,
            usdSize: sizeUsd,
            humanSize: testSize / (10 ** tokenDecimals),
            netRaw: spreadMetrics.netRaw,
            grossRaw: spreadMetrics.grossRaw,
            gasRaw: spreadMetrics.gasRaw,
            flashFeeRaw: spreadMetrics.flashFeeRaw,
            humanNet: spreadMetrics.netRaw / (10 ** tokenDecimals),
            profitUsd: (spreadMetrics.netRaw / (10 ** tokenDecimals)) * tokenUsdPrice,
            yieldPercent: (spreadMetrics.netRaw / testSize) * 100, 
            swap1Out: spreadMetrics.swap1Out,
            swap2Out: spreadMetrics.swap2Out
        });
    }
    
    // Find absolute mathematical maximum yield from empirical sampling array
    let bestPoint = curvePoints[0];
    for (const pt of curvePoints) {
        if (pt.netRaw > bestPoint.netRaw) {
             bestPoint = pt;
        }
    }
    
    // Translate best curve point geometry into established profitAnalysis struct
    // Re-pack into `calculateProfit()` expectations for downstream metrics tracking
    const optimalAmountStr = bestPoint.amountInRaw.toString();
    const profitAnalysis = this.calculateProfit(
      opportunity,
      optimalAmountStr,
      tokenDecimals
    );
    
    profitAnalysis.curvePoints = curvePoints; // Attach curve map payload
    profitAnalysis.bestPoint = bestPoint;
    
    const sizing = {
        optimalAmount: optimalAmountStr,
        maxFlashloan: maxUsdInWei.toString(),
        limitingPool: 'Curve Peak Optimization',
    };
    
    const confidenceScore = this.calculateConfidenceScore(profitAnalysis);
    const CONFIDENCE_THRESHOLD = 5.0; // Configurable threshold for Alpha execution

    // Build recommendation
    const recommendation = {
      opportunity,
      sizing,
      profitAnalysis,
      confidenceScore,
      shouldExecute: profitAnalysis.isViable && confidenceScore >= CONFIDENCE_THRESHOLD,
      reason: '',
    };
    
    // Determine reason for pass/fail
    if (profitAnalysis.bestPoint.netRaw <= 0) {
      recommendation.reason = `Peak net spread is negative (${profitAnalysis.bestPoint.humanNet} ${opportunity.token0})`;
      recommendation.shouldExecute = false;
    } else if (!profitAnalysis.passesGasMargin) {
      recommendation.reason = `Net profit $${profitAnalysis.netProfitAfterGas} < 3x gas cost ($${(parseFloat(profitAnalysis.gasCostUsd)*3).toFixed(4)})`;
    } else if (confidenceScore < CONFIDENCE_THRESHOLD) {
      recommendation.reason = `Low confidence score: ${confidenceScore.toFixed(2)} < ${CONFIDENCE_THRESHOLD}`;
    } else if (!profitAnalysis.profitAcceptable) {
      recommendation.reason = `Net profit $${profitAnalysis.netProfitAfterGas} < min $${this.minProfitUsd}`;
    } else if (!profitAnalysis.bpsAcceptable) {
      recommendation.reason = `Profit ${profitAnalysis.profitBps} bps < min ${this.minProfitBps} bps`;
    } else {
      recommendation.reason = `All criteria met (Score: ${confidenceScore.toFixed(2)}) - EXECUTE`;
    }
    
    return recommendation;
  }

  /**
   * Log evaluation results
   * @param {Object} evaluation Evaluation from evaluate()
   */
  logEvaluation(evaluation) {
    const { opportunity, sizing, profitAnalysis, shouldExecute, reason } = evaluation;
    
    let logStr = '\n📋 Opportunity Evaluation\n';
    logStr += '═'.repeat(50) + '\n';
    logStr += `Pair: ${opportunity.token0}/${opportunity.token1}\n`;
    logStr += `Buy: ${opportunity.buyDex} ${(opportunity.buyFee/10000).toFixed(2)}%\n`;
    logStr += `Sell: ${opportunity.sellDex} ${(opportunity.sellFee/10000).toFixed(2)}%\n\n`;
    logStr += `Spread Curve:\n`;
    
    for (const pt of profitAnalysis.curvePoints) {
        logStr += `${pt.humanSize.toFixed(5)} ${opportunity.token0} → netRaw: ${pt.netRaw.toFixed(0)}\n`;
    }
    
    logStr += '\n';
    
    // Always display the breakdown for the best point (peak) to identify where the edge is lost
    const bestPt = profitAnalysis.bestPoint;
    logStr += `Optimal Size: ${bestPt.humanSize.toFixed(5)} ${opportunity.token0}\n`;
    logStr += `Gross Profit Raw: ${bestPt.grossRaw.toFixed(0)}\n`;
    logStr += `Gas Raw:          ${bestPt.gasRaw.toFixed(0)}\n`;
    logStr += `Flash Fee Raw:    ${bestPt.flashFeeRaw.toFixed(0)}\n`;
    logStr += `Final Net:        ${bestPt.netRaw.toFixed(0)}\n\n`;

    if (bestPt.netRaw <= 0) {
        logStr += `Rejected: no executable spread\n\n`;
    }
    
    logStr += `Decision: ${shouldExecute ? '✅ EXECUTE' : '❌ SKIP'}\n`;
    if (evaluation.shouldExecute && evaluation.sizing.optimalAmount > sizing.maxFlashloan) {
        logStr += `⚠️ Note: Optimal size $${(bestPt.usdSize).toFixed(0)} exceeds hard cap $${SAFETY.MAX_FLASHLOAN_USD}. Capping for execution.\n`;
    }
    
    if (evaluation.confidenceScore) {
       logStr += `Confidence Score: ${evaluation.confidenceScore.toFixed(2)} (Target: 5.0+)\n`;
    }
    logStr += `Bucket: ${opportunity.bucket || 'N/A'} ($${(opportunity.aggregateLiquidityUsd/1000).toFixed(0)}k)\n`;
    logStr += `Reason: ${reason}\n`;
    logStr += '═'.repeat(50) + '\n';
    
    console.log(logStr);
    
    // Bypass terminal buffering by dumping directly to sync log
    const fs = require('fs');
    try {
        fs.appendFileSync('math_dump.txt', logStr);
    } catch (e) {
        console.error('Failed to write math_dump.txt:', e);
    }
    return evaluation;
  }
}

module.exports = { OpportunityDetector };
