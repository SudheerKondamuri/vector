// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {VectorEscrow, IERC20Minimal} from "../src/VectorEscrow.sol";

interface Vm {
    function prank(address) external;
    function expectRevert(bytes4) external;
    function warp(uint256) external;
}

contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function assertEq(uint256 left, uint256 right) internal pure { require(left == right, "assertEq(uint256)"); }
    function assertEq(address left, address right) internal pure { require(left == right, "assertEq(address)"); }
    function assertEq(VectorEscrow.Status left, VectorEscrow.Status right) internal pure { require(left == right, "assertEq(status)"); }
}

contract MockToken is IERC20Minimal {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) { allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true; }
}

contract VectorEscrowTest is Test {
    VectorEscrow private escrow;
    MockToken private token;
    address private sponsor = address(0xA11CE);
    address private operator = address(0xB0B);

    function setUp() public {
        escrow = new VectorEscrow();
        token = new MockToken();
        token.mint(sponsor, 1_000 ether);
        vm.prank(sponsor);
        token.approve(address(escrow), type(uint256).max);
    }

    function _fund() private returns (uint256 id) {
        vm.prank(sponsor);
        id = escrow.createEscrow(operator, address(token), 100 ether, keccak256("task"), keccak256("policy"), 48 hours);
    }

    function testReleaseAfterChallengeWindow() public {
        uint256 id = _fund();
        vm.prank(sponsor);
        escrow.requestRelease(id);
        vm.expectRevert(VectorEscrow.ChallengeOpen.selector);
        escrow.finalizeRelease(id);
        vm.warp(block.timestamp + 48 hours);
        escrow.finalizeRelease(id);
        (, , , uint128 amount, , , , , VectorEscrow.Status status) = escrow.escrows(id);
        assertEq(amount, 100 ether);
        assertEq(uint8(status), uint8(VectorEscrow.Status.Released));
        assertEq(token.balanceOf(operator), 100 ether);
    }

    function testOperatorCanChallengeAndSponsorResolvesRefund() public {
        uint256 id = _fund();
        vm.prank(sponsor);
        escrow.requestRelease(id);
        vm.prank(operator);
        escrow.challenge(id);
        vm.prank(sponsor);
        escrow.resolveChallenge(id, false);
        assertEq(token.balanceOf(sponsor), 1_000 ether);
        (, , , , , , , , VectorEscrow.Status status) = escrow.escrows(id);
        assertEq(uint8(status), uint8(VectorEscrow.Status.Refunded));
    }

    function invariantEscrowFundsRemainConserved() public view {
        uint256 contractBalance = token.balanceOf(address(escrow));
        uint256 total;
        for (uint256 id = 1; id < escrow.nextEscrowId(); id++) {
            (, , address tokenAddress, uint128 amount, , , , , VectorEscrow.Status status) = escrow.escrows(id);
            if (status == VectorEscrow.Status.Funded || status == VectorEscrow.Status.PendingRelease || status == VectorEscrow.Status.Challenged) {
                assertEq(tokenAddress, address(token));
                total += amount;
            }
        }
        assertEq(contractBalance, total);
    }
}
