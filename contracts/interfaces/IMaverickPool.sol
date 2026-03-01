// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMaverickPool {
    struct SwapParams {
        uint256 amount;
        bool tokenAIn;
        bool exactOutput;
        uint256 sqrtPriceLimitD18;
    }

    function swap(
        address recipient,
        uint256 amount,
        bool tokenAIn,
        bool exactOutput,
        uint256 sqrtPriceLimitD18,
        bytes calldata data
    ) external returns (uint256 amountIn, uint256 amountOut);

    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
}
