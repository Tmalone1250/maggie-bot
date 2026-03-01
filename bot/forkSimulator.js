/**
 * Fork Simulator Module
 * Wraps local Foundry Anvil instances for deterministic execution testing
 */
const { spawn } = require('child_process');
const { ethers } = require('ethers');
const { BASE_RPC_URL } = require('./config');

/**
 * @class ForkSimulator
 * @description Manages a local Anvil fork instance to tightly simulate transaction paths with dynamic gas overrides
 */
class ForkSimulator {
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || BASE_RPC_URL;
    this.port = options.port || 8546;
    this.localRpc = `http://127.0.0.1:${this.port}`;
    this.provider = null;
    this.anvilProcess = null;
    this.isReady = false;
  }

  /**
   * Start the Anvil fork process
   */
  async start() {
    if (this.anvilProcess) return;

    console.log(`\n[ForkSimulator] Checking for existing Anvil instance on port ${this.port}...`);
    try {
        const provider = new ethers.JsonRpcProvider(this.localRpc);
        await provider.getBlockNumber();
        console.log('[ForkSimulator] ✅ Connected to existing Anvil fork!');
        this.provider = provider;
        this.isReady = true;
        return;
    } catch (e) {
        // Not running, proceed to spawn
    }

    console.log(`[ForkSimulator] Starting new Anvil fork on port ${this.port}...`);
    
    // Determine the anvil command and path
    let invokeCommand = 'anvil';
    let invokeArgs = ['--fork-url', this.rpcUrl, '--port', this.port.toString(), '--silent'];

    // If we're on Windows but calling wsl, or if we need a specific path
    if (process.platform === 'win32') {
        invokeCommand = 'wsl';
        invokeArgs = ['~/.foundry/bin/anvil', ...invokeArgs];
    } else {
        // In Linux/WSL, check if anvil is in path, otherwise try default foundry home
        const fs = require('fs');
        const os = require('os');
        const defaultAnvilPath = `${os.homedir()}/.foundry/bin/anvil`;
        if (!this._isInPath('anvil') && fs.existsSync(defaultAnvilPath)) {
            invokeCommand = defaultAnvilPath;
        }
    }

    this.anvilProcess = spawn(invokeCommand, invokeArgs);

    return new Promise((resolve, reject) => {
      let resolved = false;

      // Listen for initial errors (like ENOENT)
      this.anvilProcess.on('error', (err) => {
        console.error('[ForkSimulator] ❌ Failed to start Anvil:', err.message);
        this.isReady = false;
        if (!resolved) {
            resolved = true;
            reject(err);
        }
      });

      // Give it a bit to start, then verify with a provider call
      const checkInterval = setInterval(async () => {
        try {
            const provider = new ethers.JsonRpcProvider(this.localRpc);
            await provider.getBlockNumber(); // Test connection
            clearInterval(checkInterval);
            this.provider = provider;
            this.isReady = true;
            console.log('[ForkSimulator] ✅ Anvil fork is ready and verified!');
            if (!resolved) {
                resolved = true;
                resolve();
            }
        } catch (e) {
            // Not ready yet, keep waiting
        }
      }, 500);

      // Safety timeout
      setTimeout(() => {
        if (!resolved) {
            clearInterval(checkInterval);
            resolved = true;
            reject(new Error("Anvil failed to start within 10 seconds."));
        }
      }, 10000);

      this.anvilProcess.on('exit', (code) => {
         this.isReady = false;
         if (code !== 0 && code !== null) {
            console.error(`[ForkSimulator] Anvil process exited with code ${code}`);
         }
      });
    });
  }

  _isInPath(cmd) {
    try {
        require('child_process').execSync(`which ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
  }

  /**
   * Stop the Anvil fork process
   */
  stop() {
    if (this.anvilProcess) {
      console.log(`[ForkSimulator] Shutting down spawned Anvil fork on port ${this.port}...`);
      this.anvilProcess.kill();
      this.anvilProcess = null;
    } else {
      console.log(`[ForkSimulator] Detaching from external Anvil fork on port ${this.port}...`);
    }
    this.isReady = false;
    this.provider = null;
  }

  /**
   * Simulate a transaction against the exact next block
   * @param {Object} tx The transaction object to simulate
   * @param {number} baseFeeMultiplier Simulate a baseFee spike (e.g., 1.25x for a 25% spike) 
   * @returns {Object} Simulation result containing reverted status and gas usage
   */
  async simulateAtNextBlock(tx, baseFeeMultiplier = 1.0) {
    if (!this.isReady || !this.provider) {
       throw new Error("[ForkSimulator] Simulator is not running.");
    }

    try {
        // Fetch current base fee from the fork
        const feeData = await this.provider.getFeeData();
        const currentBaseFee = feeData.gasPrice || ethers.parseUnits("0.001", "gwei"); 
        
        // Spike the gas if requested (simulating adversarial block conditions)
        if (baseFeeMultiplier > 1.0) {
            const nextBaseFee = (currentBaseFee * BigInt(Math.floor(baseFeeMultiplier * 100))) / 100n;
            
            // Send anvil specific RPC command to lock the next block's base fee
            await this.provider.send('anvil_setNextBlockBaseFeePerGas', [
                ethers.toBeHex(nextBaseFee)
            ]);
        }

        // We use eth_call here against the isolated fork state, because we want to see if it reverts 
        // under the spiky conditions we just enforced globally on the fork
        const resultHexString = await this.provider.call({
            to: tx.to,
            data: tx.data,
            from: process.env.BOT_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000',
        });
        
        // Estimate the gas that would have been used exactly
        const gasEstimate = await this.provider.estimateGas({
            to: tx.to,
            data: tx.data,
            from: process.env.BOT_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000',
        });

        return {
            reverted: false,
            gasUsed: gasEstimate,
            returnHex: resultHexString
        };

    } catch (error) {
        // Ethers throws an execution reverted error when eth_call fails on the node
        return {
            reverted: true,
            error: error.message,
            gasUsed: 0n
        };
    }
  }
}

module.exports = { ForkSimulator };
