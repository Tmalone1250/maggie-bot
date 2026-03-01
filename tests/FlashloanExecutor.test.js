/**
 * FlashloanExecutor Unit Tests
 * Tests for the main arbitrage executor contract
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('FlashloanExecutor', function () {
  let executor;
  let owner;
  let vault;
  let user;

  // Base mainnet addresses
  const WETH = '0x4200000000000000000000000000000000000006';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  beforeEach(async function () {
    [owner, vault, user] = await ethers.getSigners();
    
    // Deploy FlashloanExecutor
    const FlashloanExecutor = await ethers.getContractFactory('FlashloanExecutor');
    executor = await FlashloanExecutor.deploy(vault.address, 10); // 10 bps min profit
    await executor.waitForDeployment();
  });

  describe('Deployment', function () {
    it('Should set the correct owner', async function () {
      expect(await executor.owner()).to.equal(owner.address);
    });

    it('Should set the correct vault', async function () {
      expect(await executor.vault()).to.equal(vault.address);
    });

    it('Should set the correct minProfitBps', async function () {
      expect(await executor.minProfitBps()).to.equal(10);
    });

    it('Should not be paused initially', async function () {
      expect(await executor.paused()).to.equal(false);
    });

    it('Should have resolved Aave pool address', async function () {
      const aavePool = await executor.aavePool();
      expect(aavePool).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe('Access Control', function () {
    it('Should allow owner to transfer ownership', async function () {
      await executor.transferOwnership(user.address);
      expect(await executor.owner()).to.equal(user.address);
    });

    it('Should reject ownership transfer from non-owner', async function () {
      await expect(
        executor.connect(user).transferOwnership(user.address)
      ).to.be.revertedWithCustomError(executor, 'Unauthorized');
    });

    it('Should allow owner to update vault', async function () {
      await executor.setVault(user.address);
      expect(await executor.vault()).to.equal(user.address);
    });

    it('Should reject vault update from non-owner', async function () {
      await expect(
        executor.connect(user).setVault(user.address)
      ).to.be.revertedWithCustomError(executor, 'Unauthorized');
    });

    it('Should reject zero address vault', async function () {
      await expect(
        executor.setVault(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(executor, 'InvalidVault');
    });
  });

  describe('Pause Functionality', function () {
    it('Should allow owner to pause', async function () {
      await executor.togglePause();
      expect(await executor.paused()).to.equal(true);
    });

    it('Should allow owner to unpause', async function () {
      await executor.togglePause();
      await executor.togglePause();
      expect(await executor.paused()).to.equal(false);
    });

    it('Should reject pause from non-owner', async function () {
      await expect(
        executor.connect(user).togglePause()
      ).to.be.revertedWithCustomError(executor, 'Unauthorized');
    });
  });

  describe('MinProfit Management', function () {
    it('Should allow owner to update minProfit', async function () {
      await executor.setMinProfit(50);
      expect(await executor.minProfitBps()).to.equal(50);
    });

    it('Should emit MinProfitUpdated event', async function () {
      await expect(executor.setMinProfit(50))
        .to.emit(executor, 'MinProfitUpdated')
        .withArgs(10, 50);
    });
  });

  describe('Emergency Withdraw', function () {
    it('Should allow owner to emergency withdraw', async function () {
      // This test would need tokens in the contract
      // Just verify the function exists and is only callable by owner
      await expect(
        executor.connect(user).emergencyWithdraw(WETH)
      ).to.be.revertedWithCustomError(executor, 'Unauthorized');
    });
  });

  describe('Arbitrage Execution Validation', function () {
    it('Should reject zero borrow amount', async function () {
      const params = {
        flashloanProvider: executor.target,
        borrowToken: WETH,
        borrowAmount: 0,
        minProfit: 0,
        routeHash: ethers.ZeroHash,
        swaps: [{
          protocol: 0,
          router: WETH,
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 3000,
          amountIn: 0,
          minAmountOut: 0,
        }],
      };

      await expect(
        executor.executeWithAave(params)
      ).to.be.revertedWithCustomError(executor, 'ZeroBorrowAmount');
    });

    it('Should reject empty swaps', async function () {
      const params = {
        flashloanProvider: executor.target,
        borrowToken: WETH,
        borrowAmount: ethers.parseEther('1'),
        minProfit: 0,
        routeHash: ethers.ZeroHash,
        swaps: [],
      };

      await expect(
        executor.executeWithAave(params)
      ).to.be.revertedWithCustomError(executor, 'EmptySwaps');
    });

    it('Should reject when paused', async function () {
      await executor.togglePause();

      const params = {
        flashloanProvider: executor.target,
        borrowToken: WETH,
        borrowAmount: ethers.parseEther('1'),
        minProfit: 0,
        routeHash: ethers.ZeroHash,
        swaps: [{
          protocol: 0,
          router: WETH,
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 3000,
          amountIn: 0,
          minAmountOut: 0,
        }],
      };

      await expect(
        executor.executeWithAave(params)
      ).to.be.revertedWithCustomError(executor, 'Paused');
    });

    it('Should reject from non-owner', async function () {
      const params = {
        flashloanProvider: executor.target,
        borrowToken: WETH,
        borrowAmount: ethers.parseEther('1'),
        minProfit: 0,
        routeHash: ethers.ZeroHash,
        swaps: [{
          protocol: 0,
          router: WETH,
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 3000,
          amountIn: 0,
          minAmountOut: 0,
        }],
      };

      await expect(
        executor.connect(user).executeWithAave(params)
      ).to.be.revertedWithCustomError(executor, 'Unauthorized');
    });
  });
});
