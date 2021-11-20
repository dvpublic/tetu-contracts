// SPDX-License-Identifier: ISC
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../pipes/Pipe.sol";
import "./LinearPipelineCalculator.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "hardhat/console.sol";


/// @title Pipe Base Contract
/// @author bogdoslav
contract LinearPipeline {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address private immutable _underlyingToken;
    LinearPipelineCalculator public calculator;
    Pipe[] public pipes;

    constructor(address underlyingToken) {
        console.log('LinearPipelineCalculator constructor address(this)', address(this));
        calculator = new LinearPipelineCalculator(this);
        _underlyingToken = underlyingToken;
    }

    /// @dev Adds pipe to the end of pipeline and connects it
    /// @param newPipe to be added
    function addPipe(Pipe newPipe) internal {
        console.log('+addPipe ', address(newPipe), newPipe.name());
        pipes.push(newPipe);
        console.log('   pipes.length', pipes.length);

        if (pipes.length > 1) {
            Pipe prevPipe = pipes[pipes.length - 2];
            console.log('   prevPipe    ', prevPipe.name());
            prevPipe.setNextPipe(address(newPipe));
            newPipe.setPrevPipe(address(prevPipe));
        } else {// first pipe should have pipeline as prev pipe to send tokens when gets
            newPipe.setPrevPipe(address(this));
            console.log('   prevPipe    ', 'LinearPipeline');
        }
    }

    /// @dev function for investing, deposits, entering, borrowing, from PipeIndex to the end
    /// @param sourceAmount in source units
    /// @return outputAmount in most underlying units
    function pumpIn(uint256 sourceAmount, uint256 fromPipeIndex)
    internal returns (uint256 outputAmount)  {
        console.log('=== pumpIn sourceAmount, fromPipeIndex', sourceAmount, fromPipeIndex);
        if (sourceAmount == 0) return 0;
        outputAmount = sourceAmount;
        uint256 len = pipes.length;
        for (uint256 i = fromPipeIndex; i < len; i++) {
            console.log('+++ put amountIn', pipes[i].name(), outputAmount);
            outputAmount = pipes[i].put(outputAmount);
        }
        console.log('last amount', outputAmount);
    }

    /// @dev function for investing, deposits, entering, borrowing, from PipeIndex to the end
    /// @param sourceAmount in source units
    /// @return outputAmount in most underlying units
    function pumpIn(uint256 sourceAmount)
    internal returns (uint256 outputAmount)  {
        console.log('=== pumpIn sourceAmount', sourceAmount);
        if (sourceAmount == 0) return 0;
        // send token to first pipe
        IERC20(_underlyingToken).safeTransfer(address(pipes[0]), sourceAmount);
        outputAmount = pumpIn(sourceAmount, 0);
        console.log('last amount', outputAmount);
    }

    /// @dev function for de-vesting, withdrawals, leaves, paybacks, from the end to PipeIndex
    /// @param underlyingAmount in most underlying units
    /// @param toPipeIndex pump out to pipe with this index
    /// @return amountOut in source units
    function pumpOut(uint256 underlyingAmount, uint256 toPipeIndex)
    internal returns (uint256 amountOut) {
        console.log('=== pumpOut underlyingAmount, toPipeIndex', underlyingAmount, toPipeIndex);
        if (underlyingAmount == 0) return 0;
        amountOut = underlyingAmount;
        uint256 len = pipes.length;
        for (uint256 i = len; i > toPipeIndex; i--) {
            Pipe pipe = pipes[i - 1];
            console.log('--- get amountOut', pipe.name(), amountOut);
            amountOut = pipe.get(amountOut);
            console.log('- amountOut', amountOut);
        }
        console.log('last amount', amountOut);

    }

    /// @dev function for de-vesting, withdrawals, leaves, paybacks, from the end to PipeIndex
    /// @param sourceAmount in source units
    /// @param toPipeIndex pump out to pipe with this index
    /// @return amountOut in source units of pipe with toPipeIndex
    function pumpOutSource(uint256 sourceAmount, uint256 toPipeIndex)
    internal returns (uint256 amountOut) {
        console.log('pumpOutSource sourceAmount, toPipeIndex', sourceAmount, toPipeIndex);
        if (sourceAmount == 0) return 0;
        uint256 underlyingAmount = calculator.getAmountInForAmountOut(sourceAmount, toPipeIndex);
        return pumpOut(underlyingAmount, toPipeIndex);
    }

    /// @dev Re-balance pipe
    /// @param pipeIndex index of the pipe to rebalance
    function rebalancePipe(uint256 pipeIndex) internal {
        Pipe pipe = pipes[pipeIndex];
        if (!pipe.needsRebalance()) return;

        (uint256 imbalance, bool deficit) = pipe.rebalance();
        if (imbalance > 0) {
            if (deficit) {
                console.log('rebalancePipe', pipe.name());
                console.log('imbalance, deficit', imbalance, deficit);
                pumpOutSource(imbalance, pipeIndex.add(1));
                // call rebalance again after we have closed deficit
                pipe.rebalance();
            } else {
                pumpIn(imbalance, pipeIndex.add(1));
            }
        }
    }

    /// @dev Re-balance all pipes
    function rebalanceAllPipes() public {
        uint256 len = pipes.length;
        for (uint256 i = 0; i < len; i++) {
            rebalancePipe(i);
        }
    }

    /// @dev Checks if re-balance need some pipe(s)
    /// @return returns true when re-balance needed
    function isRebalanceNeeded() external view returns (bool) {
        uint256 len = pipes.length;
        for (uint256 i = 0; i < len; i++) {
            if (pipes[i].needsRebalance()) return true;
        }
        return false;
    }

    /// @dev Calls claim() for all pipes
    function claimFromAllPipes() internal {
        uint256 len = pipes.length;
        for (uint256 i = 0; i < len; i++) {
            pipes[i].claim();
        }
    }

    /// @dev Function to calculate amount we will receive when we withdraw amountIn from last pipe to pipe with toPipeIndex. Should be called from another contract (LinearPipelineCalculator.sol)
    /// @param amountIn in most output tokens (lp tokens of the last pipe)
    /// @param toPipeIndex index of the pipe we should to pump out
    function getAmountOutReverted(uint256 amountIn, uint256 toPipeIndex)
    public {
        uint256 amountOut = pumpOut(amountIn, toPipeIndex);
        console.log('getAmountOutReverted amountOut', amountOut);
        // store answer in revert message data
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, amountOut)
            revert(ptr, 32)
        }
    }

    /// @dev Returns balance of output (lp) token of the last pipe
    function getMostUnderlyingBalance() public view returns (uint256) {
        uint256 last = pipes.length - 1;
        uint256 mostUnderlyingBalance = pipes[last].outputBalance();
        console.log('mostUnderlyingBalance', mostUnderlyingBalance);
        return mostUnderlyingBalance;
    }

    /// @notice Pipeline can claim coins that are somehow transferred into the pipes
    /// @param recipient Recipient address
    /// @param recipient Token address
    function salvageFromAllPipes(address recipient, address token)
    internal {
        uint256 len = pipes.length;
        for (uint256 i = 0; i < len; i++) {
            pipes[i].salvageFromPipe(recipient, token);
        }
    }

}