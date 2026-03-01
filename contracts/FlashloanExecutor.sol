// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IAaveFlashLoan.sol";
import "./interfaces/IUniswapV3.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./interfaces/IMaverickPool.sol";
import "./libraries/Config.sol";

/**
 * @title FlashloanExecutor
 * @notice Atomic flashloan arbitrage executor for Base mainnet
 * @dev Executes DEX-agnostic arbitrage with profit enforcement
 *
 * Architecture:
 * 1. Receive calldata from off-chain bot
 * 2. Request flashloan from Aave V3 or Uniswap V3
 * 3. Execute swap sequence encoded in calldata
 * 4. Enforce minimum profit on-chain
 * 5. Repay flashloan + fee
 * 6. Send profits to vault
 *
 * Security:
 * - ReentrancyGuard prevents callback attacks
 * - Owner-only execution prevents unauthorized use
 * - Profit floor prevents unprofitable trades
 * - Emergency pause for safety
 */
contract FlashloanExecutor is
    IFlashLoanSimpleReceiver,
    IUniswapV3FlashCallback
{
    // ============ State Variables ============

    /// @notice Contract owner (can execute arbitrage and pause)
    address public owner;

    /// @notice Profit vault address (receives all profits)
    address public vault;

    /// @notice Aave V3 Pool address (resolved from provider)
    address public immutable aavePool;

    /// @notice Emergency pause flag
    bool public paused;

    /// @notice Reentrancy guard
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _status;

    /// @notice Minimum profit in basis points (relative to borrowed amount)
    uint256 public minProfitBps;

    // ============ Enums ============

    /// @notice Supported AMM Architectures
    enum Protocol {
        V3,
        V2,
        MAVERICK
    }

    // ============ Structs ============

    /// @notice Swap instruction for a single swap
    struct SwapInstruction {
        Protocol protocol; // AMM Mathematics Type
        address router; // DEX router address (or pool if Maverick)
        address tokenIn; // Token to sell
        address tokenOut; // Token to buy
        uint24 fee; // Fee tier (for Uniswap V3)
        uint256 amountIn; // Amount to sell (0 = use full balance)
        uint256 minAmountOut; // Minimum output (slippage protection)
    }

    /// @notice Parameters for executing arbitrage
    struct ArbitrageParams {
        address flashloanProvider; // Aave pool or Uniswap pool
        address borrowToken; // Token to borrow
        uint256 borrowAmount; // Amount to borrow
        uint256 minProfit; // Minimum profit in borrowed token
        bytes32 routeHash; // Expected deterministic route hash
        SwapInstruction[] swaps; // Sequence of swaps
    }

    /// @notice Callback data passed through flashloan
    struct CallbackData {
        address borrowToken;
        uint256 borrowAmount;
        uint256 minProfit;
        bytes32 expectedRouteHash;
        SwapInstruction[] swaps;
    }

    // ============ Events ============

    event ArbitrageExecuted(
        address indexed borrowToken,
        uint256 borrowAmount,
        uint256 profit,
        uint256 gasUsed
    );

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );
    event VaultUpdated(address indexed previousVault, address indexed newVault);
    event PauseToggled(bool paused);
    event MinProfitUpdated(uint256 oldMinProfitBps, uint256 newMinProfitBps);
    event EmergencyWithdraw(address indexed token, uint256 amount);

    // ============ Errors ============

    error Unauthorized();
    error Paused();
    error ReentrancyGuard();
    error EmptySwaps();
    error InvalidSwapRoute(address expectedOutput, address actualOutput);
    error InvalidVault();
    error InvalidCallbackCaller();
    error InsufficientProfit(uint256 profit, uint256 required);
    error SwapFailed(uint256 index);
    error ZeroBorrowAmount();
    error InvalidRouteHash();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (_status == ENTERED) revert ReentrancyGuard();
        _status = ENTERED;
        _;
        _status = NOT_ENTERED;
    }

    // ============ Constructor ============

    /**
     * @notice Initialize the executor with owner and vault
     * @param _vault Address to receive profits
     * @param _minProfitBps Minimum profit in basis points
     */
    constructor(address _vault, uint256 _minProfitBps) {
        if (_vault == address(0)) revert InvalidVault();

        owner = msg.sender;
        vault = _vault;
        minProfitBps = _minProfitBps;
        _status = NOT_ENTERED;

        // Resolve Aave Pool address from provider
        aavePool = IPoolAddressesProvider(Config.AAVE_POOL_PROVIDER).getPool();
    }

    // ============ External Functions ============

    /**
     * @notice Execute arbitrage via Aave flashloan
     * @param params Arbitrage parameters including swaps
     * @dev Only callable by owner, not paused, and non-reentrant
     */
    function executeWithAave(
        ArbitrageParams calldata params
    ) external onlyOwner whenNotPaused nonReentrant {
        uint256 gasStart = gasleft();

        if (params.borrowAmount == 0) revert ZeroBorrowAmount();
        if (params.swaps.length == 0) revert EmptySwaps();

        // Encode callback data
        bytes memory callbackData = abi.encode(
            CallbackData({
                borrowToken: params.borrowToken,
                borrowAmount: params.borrowAmount,
                minProfit: params.minProfit,
                expectedRouteHash: params.routeHash,
                swaps: params.swaps
            })
        );

        // Record balance before
        uint256 balanceBefore = IERC20(params.borrowToken).balanceOf(
            address(this)
        );

        // Request flashloan from Aave
        IPool(aavePool).flashLoanSimple(
            address(this),
            params.borrowToken,
            params.borrowAmount,
            callbackData,
            0 // referral code
        );

        // Calculate profit
        uint256 balanceAfter = IERC20(params.borrowToken).balanceOf(
            address(this)
        );
        uint256 profit = balanceAfter - balanceBefore;

        // Transfer profit to vault
        if (profit > 0) {
            IERC20(params.borrowToken).transfer(vault, profit);
        }

        emit ArbitrageExecuted(
            params.borrowToken,
            params.borrowAmount,
            profit,
            gasStart - gasleft()
        );
    }

    /**
     * @notice Aave flashloan callback
     * @dev Called by Aave Pool after receiving borrowed funds
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Verify callback is from Aave Pool
        if (msg.sender != aavePool) revert InvalidCallbackCaller();
        if (initiator != address(this)) revert Unauthorized();

        // Decode callback data
        CallbackData memory data = abi.decode(params, (CallbackData));

        // Verify route integrity
        bytes32 computedHash = keccak256(
            abi.encode(
                data.borrowToken,
                data.borrowAmount,
                data.minProfit,
                data.swaps
            )
        );
        if (computedHash != data.expectedRouteHash) revert InvalidRouteHash();

        // Invariant: Validate swap route returns borrowed asset
        if (data.swaps.length == 0) revert EmptySwaps();
        if (data.swaps[data.swaps.length - 1].tokenOut != asset) {
            revert InvalidSwapRoute(
                asset,
                data.swaps[data.swaps.length - 1].tokenOut
            );
        }

        // Snapshot the borrowed asset balance BEFORE swaps
        uint256 preSwapBalance = IERC20(asset).balanceOf(address(this));

        // Execute swap sequence
        _executeSwaps(data.swaps);

        // Get balance AFTER swaps
        uint256 postSwapBalance = IERC20(asset).balanceOf(address(this));

        // Calculate required balance for repayment and minimum profit
        uint256 amountOwed = amount + premium;
        uint256 requiredBalance = preSwapBalance + premium + data.minProfit;

        // Verify local execution profit
        if (postSwapBalance < requiredBalance) {
            // Actual profit could underflow if there's a net loss, handled by sub on execution
            uint256 executionProfit = postSwapBalance > preSwapBalance + premium
                ? postSwapBalance - preSwapBalance - premium
                : 0;
            revert InsufficientProfit(executionProfit, data.minProfit);
        }

        // Approve repayment to Aave
        IERC20(asset).approve(aavePool, amountOwed);

        return true;
    }

    /**
     * @notice Uniswap V3 flash callback
     * @dev Called by Uniswap V3 Pool after receiving borrowed funds
     */
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        // Decode callback data
        CallbackData memory callbackData = abi.decode(data, (CallbackData));

        // Verify route integrity
        bytes32 computedHash = keccak256(
            abi.encode(
                callbackData.borrowToken,
                callbackData.borrowAmount,
                callbackData.minProfit,
                callbackData.swaps
            )
        );
        if (computedHash != callbackData.expectedRouteHash)
            revert InvalidRouteHash();

        // Verify callback is from expected pool
        address expectedPool = IUniswapV3Factory(Config.UNISWAP_V3_FACTORY)
            .getPool(
                callbackData.swaps[0].tokenIn,
                callbackData.swaps[0].tokenOut,
                callbackData.swaps[0].fee
            );
        if (msg.sender != expectedPool) revert InvalidCallbackCaller();

        // Execute swap sequence
        _executeSwaps(callbackData.swaps);

        // Calculate required repayment
        uint256 fee = fee0 > 0 ? fee0 : fee1;
        uint256 amountOwed = callbackData.borrowAmount + fee;

        // Verify profit
        uint256 balance = IERC20(callbackData.borrowToken).balanceOf(
            address(this)
        );
        if (balance < amountOwed + callbackData.minProfit) {
            revert InsufficientProfit(
                balance - amountOwed,
                callbackData.minProfit
            );
        }

        // Repay to pool
        IERC20(callbackData.borrowToken).transfer(msg.sender, amountOwed);
    }

    // ============ Internal Functions ============

    /**
     * @notice Execute a sequence of swaps across heterogeneous AMM protocols
     * @param swaps Array of multi-protocol swap instructions
     */
    function _executeSwaps(SwapInstruction[] memory swaps) internal {
        for (uint256 i = 0; i < swaps.length; i++) {
            SwapInstruction memory swap = swaps[i];

            // Determine amount to swap
            uint256 amountIn = swap.amountIn;
            if (amountIn == 0) {
                amountIn = IERC20(swap.tokenIn).balanceOf(address(this));
            }

            // Skip zero value or meaningless (same token) swaps
            if (amountIn == 0 || swap.tokenIn == swap.tokenOut) {
                continue;
            }

            // ============ Protocol Branches ============

            if (swap.protocol == Protocol.V3) {
                // V3: exactInputSingle router wrapper
                IERC20(swap.tokenIn).approve(swap.router, 0);
                IERC20(swap.tokenIn).approve(swap.router, amountIn);

                try
                    ISwapRouter(swap.router).exactInputSingle(
                        ISwapRouter.ExactInputSingleParams({
                            tokenIn: swap.tokenIn,
                            tokenOut: swap.tokenOut,
                            fee: swap.fee,
                            recipient: address(this),
                            amountIn: amountIn,
                            amountOutMinimum: swap.minAmountOut,
                            sqrtPriceLimitX96: 0
                        })
                    )
                returns (uint256) {} catch {
                    revert SwapFailed(i);
                }
            } else if (swap.protocol == Protocol.V2) {
                // V2: Generic Router wrapper
                IERC20(swap.tokenIn).approve(swap.router, 0);
                IERC20(swap.tokenIn).approve(swap.router, amountIn);

                address[] memory path = new address[](2);
                path[0] = swap.tokenIn;
                path[1] = swap.tokenOut;

                try
                    IUniswapV2Router02(swap.router).swapExactTokensForTokens(
                        amountIn,
                        swap.minAmountOut,
                        path,
                        address(this),
                        block.timestamp
                    )
                returns (uint256[] memory) {} catch {
                    revert SwapFailed(i);
                }
            } else if (swap.protocol == Protocol.MAVERICK) {
                // Maverick: Direct Pool swap (router is the pool itself)
                IERC20(swap.tokenIn).approve(swap.router, 0);
                IERC20(swap.tokenIn).approve(swap.router, amountIn);

                // Maverick natively requires determining if TokenA or TokenB is being sold against the Pool state bin
                bool tokenAIn = IMaverickPool(swap.router).tokenA() ==
                    swap.tokenIn;

                // Empty bytes passed for data, preventing callback reentrancy issues
                try
                    IMaverickPool(swap.router).swap(
                        address(this),
                        amountIn,
                        tokenAIn,
                        false, // exactOutput == false, meaning ExactInput execution
                        0,
                        "" // execution data
                    )
                returns (uint256, uint256) {} catch {
                    revert SwapFailed(i);
                }
            } else {
                revert SwapFailed(i); // Unsupported Protocol Enum
            }
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert Unauthorized();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Update vault address
     * @param newVault New vault address
     */
    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert InvalidVault();
        emit VaultUpdated(vault, newVault);
        vault = newVault;
    }

    /**
     * @notice Toggle pause state
     */
    function togglePause() external onlyOwner {
        paused = !paused;
        emit PauseToggled(paused);
    }

    /**
     * @notice Update minimum profit threshold
     * @param newMinProfitBps New minimum profit in basis points
     */
    function setMinProfit(uint256 newMinProfitBps) external onlyOwner {
        emit MinProfitUpdated(minProfitBps, newMinProfitBps);
        minProfitBps = newMinProfitBps;
    }

    /**
     * @notice Emergency withdraw tokens (in case of stuck funds)
     * @param token Token address to withdraw
     */
    function emergencyWithdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).transfer(vault, balance);
            emit EmergencyWithdraw(token, balance);
        }
    }

    /**
     * @notice Receive ETH (for WETH unwrapping if needed)
     */
    receive() external payable {}
}
