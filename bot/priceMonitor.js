/**
 * Price Monitor Module
 * Fetches and tracks prices across DEXs on Base mainnet
 */
const { createPublicClient, http, formatUnits, parseUnits } = require('viem');
const { base } = require('viem/chains');
const {
  TOKENS,
  DECIMALS,
  DEXS,
  PROTOCOL,
  FEE_TIERS,
  FACTORY_ABI,
  POOL_ABI,
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  MAVERICK_FACTORY_ABI,
  MAVERICK_POOL_ABI,
  ANVIL_RPC_URL,
  BASE_RPC_URL,
  SAFETY,
} = require('./config');

/**
 * @class PriceMonitor
 * @description Monitors prices across DEXs and identifies discrepancies
 */
class PriceMonitor {
  constructor(useAnvil = false) {
    this.client = createPublicClient({
      chain: base,
      transport: http(useAnvil ? ANVIL_RPC_URL : BASE_RPC_URL),
    });
    
    // Cache for pool addresses
    this.poolCache = new Map();
    
    // Price cache with timestamps
    this.priceCache = new Map();
    this.ethPriceUsd = 3000; // Updated dynamically
  }

  setEthPrice(price) {
    this.ethPriceUsd = price;
  }

  /**
   * Get pool address for a token pair dynamically based on Protocol
   * @param {string} tokenA First token address
   * @param {string} tokenB Second token address
   * @param {number} fee Fee tier (Only relevant for V3 and Maverick)
   * @param {Object} dex DEX registry object
   * @returns {Promise<string>} Pool/Pair address
   */
  async getPoolAddress(tokenA, tokenB, fee, dex) {
    const cacheKey = `${dex.factory}-${tokenA}-${tokenB}-${fee}`;
    
    if (this.poolCache.has(cacheKey)) {
      return this.poolCache.get(cacheKey);
    }

    let poolAddress = '0x0000000000000000000000000000000000000000';

    if (dex.protocol === PROTOCOL.V3) {
        poolAddress = await this.client.readContract({
          address: dex.factory, abi: FACTORY_ABI,
          functionName: 'getPool', args: [tokenA, tokenB, fee]
        });
    } else if (dex.protocol === PROTOCOL.V2) {
        // V2 Factory doesn't use fee tiers. Skip re-fetching if we already polled this V2 pair on a different fee loop
        if (fee !== FEE_TIERS.LOW) return poolAddress; 
        
        poolAddress = await this.client.readContract({
          address: dex.factory, abi: UNISWAP_V2_FACTORY_ABI,
          functionName: 'getPair', args: [tokenA, tokenB]
        });
    } else if (dex.protocol === PROTOCOL.MAVERICK) {
        // Maverick V1 Default Tick Spacing lookup
        // Note: Full Maverick probing requires sweeping tickSpacing. 
        // We use 10 as default for major stable pairs to map initial bounds.
        try {
            poolAddress = await this.client.readContract({
                address: dex.factory, abi: MAVERICK_FACTORY_ABI,
                functionName: 'lookup', args: [tokenA, tokenB, fee, 10]
            });
        } catch {
             // Suppress Maverick specific lookup reverts (e.g. invalid fee/spacing combo)
        }
    }

    if (poolAddress !== '0x0000000000000000000000000000000000000000') {
      this.poolCache.set(cacheKey, poolAddress);
    }

    return poolAddress;
  }

  /**
   * Get current pool state (price, liquidity, tick)
   * @param {string} poolAddress Pool address
   * @returns {Promise<Object>} Pool state
   */
  async getPoolState(poolAddress) {
    const [slot0, liquidity, token0, token1, fee] = await Promise.all([
      this.client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'slot0',
      }),
      this.client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'liquidity',
      }),
      this.client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'token0',
      }),
      this.client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'token1',
      }),
      this.client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'fee',
      }),
    ]);

    const sqrtPriceX96 = slot0[0];
    const tick = slot0[1];

    return {
      sqrtPriceX96,
      tick,
      liquidity,
      token0,
      token1,
      fee,
    };
  }

  /**
   * Calculate price from sqrtPriceX96
   * @param {bigint} sqrtPriceX96 Square root price in Q96 format
   * @param {number} token0Decimals Decimals of token0
   * @param {number} token1Decimals Decimals of token1
   * @returns {number} Price of token0 in terms of token1
   */
  sqrtPriceToPrice(sqrtPriceX96, token0Decimals, token1Decimals) {
    const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
    const price = sqrtPrice ** 2;
    // Adjust for decimal difference
    const decimalAdjustment = 10 ** (token0Decimals - token1Decimals);
    return price * decimalAdjustment;
  }

  /**
   * Get prices for a token pair intelligently sweeping across V2, V3, and customized AMM structures
   * @param {string} tokenA First token
   * @param {string} tokenB Second token
   * @returns {Promise<Array>} Array of price data objects
   */
  async getPricesForPair(tokenA, tokenB) {
    const prices = [];
    const feeTiers = Object.values(FEE_TIERS);

    for (const dex of DEXS) {
      for (const fee of feeTiers) {
        try {
          const poolAddress = await this.getPoolAddress(tokenA, tokenB, fee, dex);
          
          if (poolAddress === '0x0000000000000000000000000000000000000000') {
            // console.log(`  - No pool for ${dex.name} at fee ${fee}`);
            continue;
          }

          console.log(`  🔍 Found pool for ${dex.name}: ${poolAddress} (Fee: ${fee})`);

          let price = 0;
          let liquidity = "0";
          let token0 = tokenA;
          let token1 = tokenB;
          let tick = 0;
          let derivedFee = fee; // V2 defaults to 300 bps (0.3%) normally

          if (dex.protocol === PROTOCOL.V3) {
              const state = await this.getPoolState(poolAddress);
              token0 = state.token0;
              token1 = state.token1;
              
              const t0Dec = DECIMALS[token0] || 18;
              const t1Dec = DECIMALS[token1] || 18;
              price = this.sqrtPriceToPrice(state.sqrtPriceX96, t0Dec, t1Dec);
              liquidity = state.liquidity.toString();
              tick = Number(state.tick);
          } else if (dex.protocol === PROTOCOL.V2) {
              const [reserves, t0, t1] = await Promise.all([
                  this.client.readContract({ address: poolAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'getReserves' }),
                  this.client.readContract({ address: poolAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'token0' }),
                  this.client.readContract({ address: poolAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'token1' })
              ]);
              token0 = t0; token1 = t1;
              const reserve0 = BigInt(reserves[0]);
              const reserve1 = BigInt(reserves[1]);
              
              const t0Dec = DECIMALS[token0] || 18;
              const t1Dec = DECIMALS[token1] || 18;
              
              // Standard X*Y=K invariant Price
              price = (Number(reserve1) / (10 ** t1Dec)) / (Number(reserve0) / (10 ** t0Dec));
              
              // Correct BigInt-safe liquidity calculation for V2 (sqrt(r0*r1))
              // We use a safe BigInt sqrt approximation or Number floor
              const r0r1 = reserve0 * reserve1;
              liquidity = Math.floor(Math.sqrt(Number(r0r1))).toString();
              derivedFee = 3000; // Force 0.3% assumption for V2 pools mathematically
          } else if (dex.protocol === PROTOCOL.MAVERICK) {
               const [state, t0, t1] = await Promise.all([
                  this.client.readContract({ address: poolAddress, abi: MAVERICK_POOL_ABI, functionName: 'getState' }),
                  this.client.readContract({ address: poolAddress, abi: MAVERICK_POOL_ABI, functionName: 'tokenA' }),
                  this.client.readContract({ address: poolAddress, abi: MAVERICK_POOL_ABI, functionName: 'tokenB' })
              ]);
              token0 = t0; token1 = t1;
              tick = Number(state.activeTick);
              
              const t0Dec = DECIMALS[token0] || 18;
              const t1Dec = DECIMALS[token1] || 18;
              
              // Maverick stores price as 1.0001^tick. 
              const rawPrice = 1.0001 ** tick;
              const decimalAdjustment = 10 ** (t0Dec - t1Dec);
              price = rawPrice * decimalAdjustment;
              liquidity = state.binCounter.toString(); // Bins track deep protocol liquidity sizing
          }

          // Calculate USD Liquidity for Bucket Classification
          let poolValueUsd = 0;
          const t0Dec = DECIMALS[token0] || 18;
          const t1Dec = DECIMALS[token1] || 18;
          
          // Anchor Prices for USD conversion
          const getUsdPrice = (tokenAddr) => {
            if (tokenAddr.toLowerCase() === TOKENS.USDC.toLowerCase() || 
                tokenAddr.toLowerCase() === TOKENS.USDT.toLowerCase()) return 1;
            if (tokenAddr.toLowerCase() === TOKENS.WETH.toLowerCase()) return this.ethPriceUsd;
            // For other tokens (like LSTs), use mid-price relative to WETH if we have it, or fallback to ETH price proxy
            return this.ethPriceUsd; 
          };

          const p0Usd = getUsdPrice(token0);
          const p1Usd = getUsdPrice(token1);

          if (dex.protocol === PROTOCOL.V3) {
              const state = await this.getPoolState(poolAddress);
              const sqrtP = Number(state.sqrtPriceX96) / (2 ** 96);
              // Virtual Reserves proxy for V3: x_virtual = L / sqrtP
              const xVirtual = Number(state.liquidity) / sqrtP;
              const yVirtual = Number(state.liquidity) * sqrtP;
              poolValueUsd = ((xVirtual / (10 ** t0Dec)) * p0Usd) + ((yVirtual / (10 ** t1Dec)) * p1Usd);
          } else if (dex.protocol === PROTOCOL.V2) {
              // Reserves were fetched earlier for V2 price calc: reserve0, reserve1
              // We need them here too, they are in scope if we refactor or re-fetch
              // Re-fetching reserves for poolValueUsd calc robustness
              const reserves = await this.client.readContract({ address: poolAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'getReserves' });
              const r0 = Number(reserves[0]) / (10 ** t0Dec);
              const r1 = Number(reserves[1]) / (10 ** t1Dec);
              poolValueUsd = (r0 * p0Usd) + (r1 * p1Usd);
          } else if (dex.protocol === PROTOCOL.MAVERICK) {
              // For Maverick, we use a rough proxy for bin value
              poolValueUsd = 1000000; // Default to $1M (Bucket B/C) for Maverick discovery until deep probe implemented
          }

          prices.push({
            dex: dex.name,
            protocol: dex.protocol,
            factory: dex.factory,
            pool: poolAddress,
            fee: derivedFee,
            feePercent: (derivedFee / 10000).toFixed(2) + '%',
            token0: token0,
            token1: token1,
            price,
            inversePrice: 1 / price,
            liquidity: currentLiquidity.toString(),
            poolValueUsd,
            tick: tick,
            timestamp: Date.now(),
          });
        } catch (error) {
          // Pool doesn't exist or error reading - skip
          // console.error(`[PriceMonitor] Error fetching ${dex.name} (Fee: ${fee}):`, error.message);
        }
      }
    }

    return prices;
  }

  /**
   * Find arbitrage opportunities between price sources
   * @param {Array} prices Array of price data
   * @returns {Array} Array of arbitrage opportunities
   */
  findArbitrageOpportunities(prices) {
    const opportunities = [];
    
    // Compare all price pairs
    for (let i = 0; i < prices.length; i++) {
      for (let j = i + 1; j < prices.length; j++) {
        const priceA = prices[i];
        const priceB = prices[j];
        
        // Calculate price difference (as percentage)
        const priceDiff = Math.abs(priceA.price - priceB.price);
        const avgPrice = (priceA.price + priceB.price) / 2;
        const priceDiffPercent = (priceDiff / avgPrice) * 100;
        
        // Calculate total fees (both swaps)
        const totalFeeBps = (priceA.fee + priceB.fee) / 100;
        const totalFeePercent = totalFeeBps / 100;
        
        // Gross profit = price diff - fees
        const grossProfitPercent = priceDiffPercent - totalFeePercent;
        if (grossProfitPercent > 0) {
          // Determine buy/sell direction
          const buyFrom = priceA.price < priceB.price ? priceA : priceB;
          const sellTo = priceA.price < priceB.price ? priceB : priceA;

          // Tag with the aggregate liquidity bucket
          const aggregateLiquidityUsd = priceA.poolValueUsd + priceB.poolValueUsd;
          let bucket = 'D';
          if (aggregateLiquidityUsd >= SAFETY.BUCKETS.A) bucket = 'A';
          else if (aggregateLiquidityUsd >= SAFETY.BUCKETS.B) bucket = 'B';
          else if (aggregateLiquidityUsd >= SAFETY.BUCKETS.C) bucket = 'C';

          opportunities.push({
            buyDex: buyFrom.dex,
            buyProtocol: buyFrom.protocol,
            buyPool: buyFrom.pool,
            buyFee: buyFrom.fee,
            buyPrice: buyFrom.price,
            sellDex: sellTo.dex,
            sellProtocol: sellTo.protocol,
            sellPool: sellTo.pool,
            sellFee: sellTo.fee,
            sellPrice: sellTo.price,
            priceDiffPercent,
            totalFeePercent,
            grossProfitPercent,
            buyLiquidity: buyFrom.liquidity,
            sellLiquidity: sellTo.liquidity,
            token0: buyFrom.token0,
            token1: buyFrom.token1,
            aggregateLiquidityUsd,
            bucket
          });
        }
      }
    }

    // Sort: Priority to Bucket C, then B, then by profit
    opportunities.sort((a, b) => {
       const bucketOrder = { 'C': 0, 'B': 1, 'A': 2, 'D': 3 };
       if (bucketOrder[a.bucket] !== bucketOrder[b.bucket]) {
           return bucketOrder[a.bucket] - bucketOrder[b.bucket];
       }
       return b.grossProfitPercent - a.grossProfitPercent;
    });
    
    return opportunities;
  }

  /**
   * Monitor a specific pair and log opportunities
   * @param {string} tokenA First token
   * @param {string} tokenB Second token
   */
  async monitorPair(tokenA, tokenB) {
    console.log(`\n📊 Monitoring ${tokenA.slice(0, 10)}.../${tokenB.slice(0, 10)}...`);
    
    const prices = await this.getPricesForPair(tokenA, tokenB);
    
    console.log(`Found ${prices.length} price sources:`);
    prices.forEach(p => {
      console.log(`  ${p.dex} (${p.feePercent}): ${p.price.toFixed(8)} | Liq: ${p.liquidity.slice(0, 15)}...`);
    });

    const opportunities = this.findArbitrageOpportunities(prices);
    
    if (opportunities.length > 0) {
      console.log(`\n🎯 Found ${opportunities.length} potential opportunities (Ranked by Bucket/Edge):`);
      opportunities.slice(0, 5).forEach((opp, i) => {
        console.log(`\n  [${i + 1}] [Bucket ${opp.bucket}] ${opp.buyDex} → ${opp.sellDex}`);
        console.log(`      Route: ${opp.token0.slice(0,6)}.../${opp.token1.slice(0,6)}...`);
        console.log(`      Aggregate Liquidity: $${(opp.aggregateLiquidityUsd / 1000).toFixed(0)}k`);
        console.log(`      Gross Edge: ${opp.grossProfitPercent.toFixed(4)}%`);
      });
    } else {
        console.log('  No profitable opportunities found in current monitoring universe.');
    }

    return { prices, opportunities };
  }
}

module.exports = { PriceMonitor };
