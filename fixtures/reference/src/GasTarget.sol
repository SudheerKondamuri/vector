// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract GasTarget {
    function sum(uint256 n) external pure returns (uint256 total) {
        require(n <= 1000, "n too large");
        for (uint256 i = 0; i < n; i++) {
            total += i;
        }
    }
}
