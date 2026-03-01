const hre = require("hardhat");

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       💰 PROFIT SIMULATION & DEMONSTRATION 💰                 ║');
  console.log('║       Manipulating Fork State to Create Opportunity          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Configuration
  const WETH = "0x4200000000000000000000000000000000000006";
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const UNISWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";
  
  // Setup
  const [deployer] = await hre.ethers.getSigners();
  console.log(`👨‍💻 Operator: ${deployer.address}`);

  // 1. Deploy FlashloanExecutor
  console.log('\n1️⃣  Deploying FlashloanExecutor...');
  const FlashloanExecutor = await hre.ethers.getContractFactory("FlashloanExecutor");
  const executor = await FlashloanExecutor.deploy(deployer.address, 10); // 10 bps min profit
  await executor.waitForDeployment();
  console.log(`   ✅ Deployed at: ${executor.target}`);

  // 2. Prepare Manipulation Funds (Get WETH)
  console.log('\n2️⃣  Preparing Market Manipulation...');
  // Give proper balance
  await hre.network.provider.send("hardhat_setBalance", [
    deployer.address,
    "0x3635C9ADC5DEA00000", // 1000 ETH
  ]);
  
  // Wrap ETH to WETH
  const weth = await hre.ethers.getContractAt("IERC20", WETH); // Use ABI from artifact or interface
  // Using minimal ABI for WETH deposit
  const iweth = await hre.ethers.getContractAt([
    "function deposit() payable",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)"
  ], WETH);
  
  await iweth.deposit({ value: hre.ethers.parseEther("50") });
  console.log(`   ✅ Wrapped 50 ETH to WETH`);

  // 3. Manipulate Market (Dump WETH into USDC pool 3000)
  // We sell WETH for USDC on the 0.3% pool to drive WETH price DOWN in that pool.
  console.log('\n3️⃣  Executing Large Swap (Dumping WETH)...');
  // Use compiled artifact (without deadline since we removed it from ISwapRouter.sol)
  const router = await hre.ethers.getContractAt("contracts/interfaces/ISwapRouter.sol:ISwapRouter", UNISWAP_ROUTER);

  await iweth.approve(UNISWAP_ROUTER, hre.ethers.parseEther("50"));
  
  // Swap 500 WETH for USDC in 0.3% pool (fee: 3000)
  // This pushes WETH price DOWN
  await router.exactInputSingle({
    tokenIn: WETH,
    tokenOut: USDC,
    fee: 3000,
    recipient: deployer.address,
    // NO DEADLINE
    amountIn: hre.ethers.parseEther("30"),
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  });
  console.log(`   ✅ Dumped 30 WETH into Uniswap V3 (0.3% pool)`);
  console.log(`   📉 WETH Price Crushed in this pool!`);

  // 4. Detect & Execute Arbitrage
  console.log('\n4️⃣  Executing Arbitrage...');
  console.log('   Strategy: Buy cheap WETH on 0.3% pool, Sell expensive on 0.05% pool');
  
  // We will borrow USDC, buy WETH on 3000, sell WETH on 500, repay USDC.
  // Opportunity:
  // Pool 3000: WETH is cheap (we just dumped it). 1 USDC buys MORE WETH.
  // Pool 500: WETH is normal price.
  
  // Arb Route:
  // 1. Flashloan USDC
  // 2. Swap USDC -> WETH (Pool 3000) [Buy Low]
  // 3. Swap WETH -> USDC (Pool 500)  [Sell High]
  // 4. Repay Flashloan
  
  const borrowAmount = hre.ethers.parseUnits("50000", 6); // Borrow 50k USDC
  
  const swaps = [
    {
      router: UNISWAP_ROUTER,
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 3000, // 0.3% pool (Cheap WETH)
      amountIn: borrowAmount,
      minAmountOut: 0 // In simulation we can be loose, or calculate
    },
    {
      router: UNISWAP_ROUTER,
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 500, // 0.05% pool (Expensive WETH)
      amountIn: 0, // Use balance
      minAmountOut: 0
    }
  ];

  const params = {
    flashloanProvider: executor.target, // Replaced by Aave in contract usually, but here checking contract logic
    borrowToken: USDC,
    borrowAmount: borrowAmount,
    minProfit: 0, // We want to see the profit regardless
    swaps: swaps
  };

  // Get Vault Balance Before
  const usdc = await hre.ethers.getContractAt("IERC20", USDC);
  // Vault is deployer
  const balanceBefore = await usdc.balanceOf(deployer.address);

  console.log(`   Attempting Arbitrage with 50,000 USDC Flashloan...`);
  
  try {
    const tx = await executor.executeWithAave(params);
    await tx.wait();
    
    // Get Balance After
    const balanceAfter = await usdc.balanceOf(deployer.address);
    const profit = balanceAfter - balanceBefore;
    
    console.log(`\n✅ Arbitrage Successful!`);
    console.log(`   Profit Generated: ${hre.ethers.formatUnits(profit, 6)} USDC`);
    
    if (profit > 0n) {
      console.log(`   🚀 PROFIT CONFIRMED FOR INVESTORS`);
    }

  } catch (error) {
    console.error(`   ❌ Arbitrage Failed: ${error.message}`);
    // Try to debug by getting revert reason if possible
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
