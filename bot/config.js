/**
 * Bot Configuration for Base Mainnet
 * All addresses verified for Chain ID 8453
 */
require('dotenv').config();

// Chain configuration
const CHAIN_ID = 8453;
const CHAIN_NAME = 'base';

// RPC endpoints
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const ANVIL_RPC_URL = 'http://127.0.0.1:8545';
// MEV-Protected RPC Endpoint (e.g. Flashbots Protect, Merkle, etc)
const PRIVATE_RPC_URL = process.env.PRIVATE_RPC_URL || 'https://rpc.mevblocker.io';

// Flashloan Providers
const AAVE_POOL_PROVIDER = '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D';

// Common DEX Protocol Types mapping to FlashloanExecutor.sol Protocol Enum
const PROTOCOL = {
  V3: 0,
  V2: 1,
  MAVERICK: 2
};

// DEX Master Registry
const DEXS = [
  // V3 Architecture
  { name: 'Uniswap V3', protocol: PROTOCOL.V3, factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' },
  { name: 'SushiSwap V3', protocol: PROTOCOL.V3, factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4' },
  { name: 'PancakeSwap V3', protocol: PROTOCOL.V3, factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'},
  { name: 'Alien Base V3', protocol: PROTOCOL.V3, factory: '0x0Fd83557b2be93617c9C1C1B6fd549401C74558C'},
  
  // V2 Architecture
  { name: 'SwapBased V2', protocol: PROTOCOL.V2, factory: '0x04C9f118d21e8B767D2e50C946f0cC9F6C367300'},
  { name: 'BaseSwap V2', protocol: PROTOCOL.V2, factory: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB'}, // Derived from their router 0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066
  
  // Maverick Custom Architecture
  { name: 'Maverick V1', protocol: PROTOCOL.MAVERICK, factory: '0xB2855783a346735e4AAe0c1eb894DEf861Fa9b45' },
  { name: 'Maverick V2 (Automated)', protocol: PROTOCOL.MAVERICK, factory: '0xd94C8f6D13Cf480FfAC686712C63471D1596cc29' }
];

// Fallback Routers if needed for encoding
const UNISWAP_V3_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const UNISWAP_V3_QUOTER = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';

const TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  cbETH: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
  rETH: '0xb6fe221f0051392657d532a2c1106e2f5e73624c',
  wstETH: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452',
};

const DECIMALS = {
  [TOKENS.WETH]: 18,
  [TOKENS.USDC]: 6,
  [TOKENS.USDT]: 6,
  [TOKENS.DAI]: 18,
  [TOKENS.cbETH]: 18,
  [TOKENS.rETH]: 18,
  [TOKENS.wstETH]: 18,
};

// Uniswap V3 Fee Tiers (in hundredths of a basis point)
const FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.30%
  HIGH: 10000,    // 1.00%
};

// Safety Parameters
const SAFETY = {
  MAX_SLIPPAGE_BPS: parseInt(process.env.MAX_SLIPPAGE_BPS) || 50,        // 0.5%
  MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD) || 0.50,        // $0.50
  MIN_PROFIT_BPS: 10,                                                     // 0.1% of borrowed
  MAX_FLASHLOAN_PERCENT: 10,                                             // 10% of pool liquidity
  MAX_FLASHLOAN_USD: parseFloat(process.env.MAX_FLASHLOAN_USD) || 50,    // Hard cap for live testing ($50 default)
  MAX_PRICE_IMPACT_BPS: 30,                                              // 0.3%
  MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI) || 0.001,
  MAX_BID_PERCENTAGE: parseFloat(process.env.MAX_BID_PERCENTAGE) || 0.30, // 30% of profit to builder
  MIN_LIQUIDITY_THRESHOLD: process.env.MIN_LIQUIDITY_THRESHOLD || '1000', // Minimum liquidity to consider a pool
  BUCKETS: {
    A: 10000000,  // > $10M
    B: 1000000,   // $1M - $10M
    C: 300000,    // $300k - $1M
    D: 0          // < $300k
  }
};

// Aave flashloan fee
const AAVE_FLASH_FEE_BPS = 5; // 0.05%

// Monitor intervals
const POLL_INTERVAL_MS = 500;  // 500ms between price checks

// Profit vault (set via environment)
const PROFIT_VAULT = process.env.PROFIT_VAULT_ADDRESS || '';

const MONITORED_PAIRS = [
  { token0: TOKENS.WETH, token1: TOKENS.USDC, name: 'WETH/USDC' },
  { token0: TOKENS.WETH, token1: TOKENS.USDT, name: 'WETH/USDT' },
  { token0: TOKENS.USDC, token1: TOKENS.USDT, name: 'USDC/USDT' },
  { token0: TOKENS.cbETH, token1: TOKENS.WETH, name: 'cbETH/WETH' },
  { token0: TOKENS.rETH, token1: TOKENS.WETH, name: 'rETH/WETH' },
  { token0: TOKENS.wstETH, token1: TOKENS.WETH, name: 'wstETH/WETH' },
];

// ABIs (minimal for price fetching)
const POOL_ABI = [
  { name: 'slot0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'observationIndex', type: 'uint16' }, { name: 'observationCardinality', type: 'uint16' }, { name: 'observationCardinalityNext', type: 'uint16' }, { name: 'feeProtocol', type: 'uint8' }, { name: 'unlocked', type: 'bool' }] },
  { name: 'liquidity', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'fee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] },
];

const FACTORY_ABI = [
  { name: 'getPool', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'fee', type: 'uint24' }], outputs: [{ name: 'pool', type: 'address' }] },
];

const QUOTER_ABI = [
  { name: 'quoteExactInputSingle', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' }, { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' }] },
];

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
];

const AAVE_POOL_PROVIDER_ABI = [
  { name: 'getPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];

const AAVE_POOL_ABI = [
  { name: 'flashLoanSimple', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'receiverAddress', type: 'address' }, { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'params', type: 'bytes' }, { name: 'referralCode', type: 'uint16' }], outputs: [] },
  { name: 'FLASHLOAN_PREMIUM_TOTAL', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
];

// --- Added for Engine V2/Maverick Off-chain support ---

const UNISWAP_V2_FACTORY_ABI = [
  { name: 'getPair', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }], outputs: [{ name: 'pair', type: 'address' }] }
];

const UNISWAP_V2_PAIR_ABI = [
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'reserve0', type: 'uint112' }, { name: 'reserve1', type: 'uint112' }, { name: 'blockTimestampLast', type: 'uint32' }] },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }
];

const MAVERICK_FACTORY_ABI = [
  { name: 'lookup', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'fee', type: 'uint256' }, { name: 'tickSpacing', type: 'uint256' }], outputs: [{ name: 'pool', type: 'address' }] }
];

const MAVERICK_POOL_ABI = [
  { name: 'getState', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'state', type: 'tuple', components: [{ name: 'activeTick', type: 'int32' }, { name: 'status', type: 'uint8' }, { name: 'binCounter', type: 'uint128' }, { name: 'protocolFeeRatio', type: 'uint64' }, { name: 'protocolFeeRatioTokenA', type: 'uint64' }, { name: 'activeBinId', type: 'uint256' }] }] },
  { name: 'tokenA', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'tokenB', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }
];

module.exports = {
  CHAIN_ID,
  CHAIN_NAME,
  BASE_RPC_URL,
  ANVIL_RPC_URL,
  AAVE_POOL_PROVIDER,
  PROTOCOL,
  DEXS,
  UNISWAP_V3_ROUTER,
  UNISWAP_V3_QUOTER,
  TOKENS,
  DECIMALS,
  FEE_TIERS,
  SAFETY,
  AAVE_FLASH_FEE_BPS,
  POLL_INTERVAL_MS,
  PROFIT_VAULT,
  MONITORED_PAIRS,
  POOL_ABI,
  FACTORY_ABI,
  QUOTER_ABI,
  AAVE_POOL_PROVIDER_ABI,
  AAVE_POOL_ABI,
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  MAVERICK_FACTORY_ABI,
  MAVERICK_POOL_ABI
};
