// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Base Sepolia testnet settlement mechanics for a single verified task.
/// @dev This contract does not verify code or evidence. The sponsor is the verdict authority.
contract VectorEscrow {
    enum Status { Funded, PendingRelease, Challenged, Released, Refunded, Cancelled }

    struct Escrow {
        address sponsor;
        address operator;
        address token;
        uint128 amount;
        bytes32 taskHash;
        bytes32 policyHash;
        uint64 challengePeriod;
        uint64 releaseRequestedAt;
        Status status;
    }

    uint256 public nextEscrowId = 1;
    mapping(uint256 => Escrow) public escrows;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidPeriod();
    error MissingEscrow();
    error Unauthorized();
    error InvalidState();
    error TransferFailed();
    error ChallengeOpen();
    error ChallengeClosed();

    event EscrowFunded(uint256 indexed escrowId, address indexed sponsor, address indexed operator, address token, uint256 amount, bytes32 taskHash, bytes32 policyHash);
    event ReleaseRequested(uint256 indexed escrowId, uint256 challengeEndsAt);
    event ChallengeOpened(uint256 indexed escrowId, address indexed operator);
    event EscrowReleased(uint256 indexed escrowId, address indexed operator, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed sponsor, uint256 amount);
    event EscrowCancelled(uint256 indexed escrowId, address indexed sponsor, uint256 amount);

    function createEscrow(
        address operator,
        address token,
        uint128 amount,
        bytes32 taskHash,
        bytes32 policyHash,
        uint64 challengePeriod
    ) external returns (uint256 escrowId) {
        if (operator == address(0) || token == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (challengePeriod == 0 || challengePeriod > 30 days) revert InvalidPeriod();
        if (!IERC20Minimal(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        escrowId = nextEscrowId++;
        escrows[escrowId] = Escrow({
            sponsor: msg.sender, operator: operator, token: token, amount: amount, taskHash: taskHash, policyHash: policyHash, challengePeriod: challengePeriod,
            releaseRequestedAt: 0, status: Status.Funded
        });
        emit EscrowFunded(escrowId, msg.sender, operator, token, amount, taskHash, policyHash);
    }

    function requestRelease(uint256 escrowId) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.sponsor) revert Unauthorized();
        if (escrow.status != Status.Funded) revert InvalidState();
        escrow.releaseRequestedAt = uint64(block.timestamp);
        escrow.status = Status.PendingRelease;
        emit ReleaseRequested(escrowId, block.timestamp + escrow.challengePeriod);
    }

    function challenge(uint256 escrowId) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.operator) revert Unauthorized();
        if (escrow.status != Status.PendingRelease) revert InvalidState();
        if (block.timestamp >= escrow.releaseRequestedAt + escrow.challengePeriod) revert ChallengeClosed();
        escrow.status = Status.Challenged;
        emit ChallengeOpened(escrowId, msg.sender);
    }

    function finalizeRelease(uint256 escrowId) external {
        Escrow storage escrow = _escrow(escrowId);
        if (escrow.status != Status.PendingRelease) revert InvalidState();
        if (block.timestamp < escrow.releaseRequestedAt + escrow.challengePeriod) revert ChallengeOpen();
        _release(escrowId, escrow);
    }

    function resolveChallenge(uint256 escrowId, bool releaseToOperator) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.sponsor) revert Unauthorized();
        if (escrow.status != Status.Challenged) revert InvalidState();
        if (releaseToOperator) _release(escrowId, escrow);
        else _refund(escrowId, escrow);
    }

    function refund(uint256 escrowId) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.sponsor) revert Unauthorized();
        if (escrow.status != Status.Funded) revert InvalidState();
        _refund(escrowId, escrow);
    }

    function cancel(uint256 escrowId) external {
        Escrow storage escrow = _escrow(escrowId);
        if (msg.sender != escrow.sponsor) revert Unauthorized();
        if (escrow.status != Status.Funded) revert InvalidState();
        escrow.status = Status.Cancelled;
        if (!IERC20Minimal(escrow.token).transfer(escrow.sponsor, escrow.amount)) revert TransferFailed();
        emit EscrowCancelled(escrowId, escrow.sponsor, escrow.amount);
    }

    function _escrow(uint256 escrowId) private view returns (Escrow storage escrow) {
        escrow = escrows[escrowId];
        if (escrow.sponsor == address(0)) revert MissingEscrow();
    }

    function _release(uint256 escrowId, Escrow storage escrow) private {
        escrow.status = Status.Released;
        if (!IERC20Minimal(escrow.token).transfer(escrow.operator, escrow.amount)) revert TransferFailed();
        emit EscrowReleased(escrowId, escrow.operator, escrow.amount);
    }

    function _refund(uint256 escrowId, Escrow storage escrow) private {
        escrow.status = Status.Refunded;
        if (!IERC20Minimal(escrow.token).transfer(escrow.sponsor, escrow.amount)) revert TransferFailed();
        emit EscrowRefunded(escrowId, escrow.sponsor, escrow.amount);
    }
}
