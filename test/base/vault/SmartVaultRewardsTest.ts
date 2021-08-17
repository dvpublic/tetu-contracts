import {ethers} from "hardhat";
import chai from "chai";
import {ContractReader, NoopStrategy} from "../../../typechain";
import {DeployerUtils} from "../../../scripts/deploy/DeployerUtils";
import {VaultUtils} from "../../VaultUtils";
import {utils} from "ethers";
import {Erc20Utils} from "../../Erc20Utils";
import {TimeUtils} from "../../TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import chaiAsPromised from "chai-as-promised";
import {CoreContractsWrapper} from "../../CoreContractsWrapper";
import {MaticAddresses} from "../../MaticAddresses";
import {UniswapUtils} from "../../UniswapUtils";

const {expect} = chai;
chai.use(chaiAsPromised);

describe("Smart vault rewards test", () => {
  let snapshot: string;
  let snapshotForEach: string;
  let signer: SignerWithAddress;
  let core: CoreContractsWrapper;
  let contractReader: ContractReader;


  before(async function () {
    snapshot = await TimeUtils.snapshot();
    signer = (await ethers.getSigners())[0];
    core = await DeployerUtils.deployAllCoreContracts(signer);

    const calculator = (await DeployerUtils.deployPriceCalculatorMatic(signer, core.controller.address))[0];

    const crLogic = await DeployerUtils.deployContract(signer, "ContractReader");
    const crProxy = await DeployerUtils.deployContract(signer, "TetuProxyGov", crLogic.address);
    contractReader = crLogic.attach(crProxy.address) as ContractReader;

    await contractReader.initialize(core.controller.address);
    await contractReader.setPriceCalculator(calculator.address);

    await UniswapUtils.buyAllBigTokens(signer);
  });

  after(async function () {
    await TimeUtils.rollback(snapshot);
  });

  beforeEach(async function () {
    snapshotForEach = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshotForEach);
  });


  it("check reward vesting for multiple accounts with SUSHI rewards and LP underlying", async () => {

    const underlying = await UniswapUtils.addLiquidity(signer, MaticAddresses.WMATIC_TOKEN, MaticAddresses.USDC_TOKEN,
        utils.parseUnits('100000').toString(), utils.parseUnits('100000', 6).toString(),
        MaticAddresses.SUSHI_FACTORY, MaticAddresses.SUSHI_ROUTER);

    const rt = MaticAddresses.SUSHI_TOKEN;

    // ******** DEPLOY VAULT *******
    const vault = await DeployerUtils.deploySmartVault(signer);
    const strategy = await DeployerUtils.deployContract(signer, "NoopStrategy",
        core.controller.address, underlying, vault.address, [MaticAddresses.ZERO_ADDRESS], [MaticAddresses.WMATIC_TOKEN, MaticAddresses.USDC_TOKEN]) as NoopStrategy;
    await vault.initializeSmartVault(
        "NOOP",
        "tNOOP",
        core.controller.address,
        underlying,
        60 * 60 * 24 * 28
    );
    await core.controller.addVaultAndStrategy(vault.address, strategy.address);
    await vault.addRewardToken(rt);

    // ********** INIT VARS **************
    const user1 = (await ethers.getSigners())[1];
    const user2 = (await ethers.getSigners())[2];
    const rtDecimals = await Erc20Utils.decimals(rt);
    const underlyingDec = await Erc20Utils.decimals(underlying);
    const duration = (await vault.duration()).toNumber();
    const time = 60 * 60 * 6;
    const rewardsTotalAmount = utils.parseUnits('10000', rtDecimals);

    console.log('underlying amount', utils.formatUnits(await Erc20Utils.balanceOf(underlying, signer.address), underlyingDec));

    await UniswapUtils.buyToken(signer, MaticAddresses.SUSHI_ROUTER, rt, utils.parseUnits('300'), MaticAddresses.WETH_TOKEN);
    await Erc20Utils.approve(rt, signer, vault.address, rewardsTotalAmount.toString());
    await vault.notifyTargetRewardAmount(rt, rewardsTotalAmount);


    const signerUndBal = +utils.formatUnits(await Erc20Utils.balanceOf(underlying, signer.address), underlyingDec);
    const signerDeposit = (signerUndBal * 0.1).toFixed(underlyingDec);
    const user1Deposit = (signerUndBal * 0.2).toFixed(underlyingDec);
    const user2Deposit = (signerUndBal * 0.3).toFixed(underlyingDec);

    await VaultUtils.deposit(signer, vault, utils.parseUnits(signerDeposit, underlyingDec))
    await Erc20Utils.transfer(underlying, signer, user1.address, utils.parseUnits(user1Deposit, underlyingDec).toString());
    await Erc20Utils.transfer(underlying, signer, user2.address, utils.parseUnits(user2Deposit, underlyingDec).toString());

    const signerUndBal2 = +utils.formatUnits(await Erc20Utils.balanceOf(underlying, signer.address), underlyingDec);

    // clean address
    await Erc20Utils.transfer(rt, signer, core.controller.address, (await Erc20Utils.balanceOf(rt, signer.address)).toString());

    //*************** CYCLES *************
    let claimedTotal = 0;
    const cycles = duration / (time + 3);
    const undSendPart = ((signerUndBal2 / cycles) * 0.99).toFixed(underlyingDec);
    console.log('cycles', cycles);
    let user1Deposited = false;
    let user2Deposited = false;
    for (let i = 0; i < cycles; i++) {
      const ppfs = +utils.formatUnits(await vault.getPricePerFullShare(), underlyingDec);

      if (i % 3 === 0) {
        if (user1Deposited) {
          await vault.connect(user1).exit();
          user1Deposited = false;
        } else {
          await VaultUtils.deposit(user1, vault, utils.parseUnits(user1Deposit, underlyingDec));
          user1Deposited = true;
        }
      }

      if (i % 5 === 0) {
        if (user2Deposited) {
          await vault.connect(user2).exit();
          user2Deposited = false;
        } else {
          await VaultUtils.deposit(user2, vault, utils.parseUnits(user2Deposit, underlyingDec))
          user2Deposited = true;
        }
      }


      await TimeUtils.advanceBlocksOnTs(time);
      const vaultRtBalance = +utils.formatUnits(await Erc20Utils.balanceOf(rt, vault.address), rtDecimals);

      const rtBalanceSigner = +utils.formatUnits(await Erc20Utils.balanceOf(rt, signer.address), rtDecimals);
      const toClaimSigner = +utils.formatUnits(await vault.earned(rt, signer.address), rtDecimals);

      const rtBalanceUser1 = +utils.formatUnits(await Erc20Utils.balanceOf(rt, user1.address), rtDecimals);
      const toClaimUser1 = +utils.formatUnits(await vault.earned(rt, user1.address), rtDecimals);

      const rtBalanceUser2 = +utils.formatUnits(await Erc20Utils.balanceOf(rt, user2.address), rtDecimals);
      const toClaimUser2 = +utils.formatUnits(await vault.earned(rt, user2.address), rtDecimals);

      console.log('Signer toClaim', toClaimSigner, 'all rewards in vault', vaultRtBalance, 'rt balance', rtBalanceSigner);
      console.log('User1 toClaim', toClaimUser1, 'all rewards in vault', vaultRtBalance, 'rt balance', rtBalanceUser1);
      console.log('User2 toClaim', toClaimUser2, 'all rewards in vault', vaultRtBalance, 'rt balance', rtBalanceUser2);

      expect(toClaimSigner).is.greaterThan(0, 'to claim is zero ' + i);
      if (user1Deposited) {
        expect(toClaimUser1).is.greaterThan(0, 'to claim is zero ' + i);
      }
      if (user2Deposited) {
        expect(toClaimUser2).is.greaterThan(0, 'to claim is zero ' + i);
      }


      await vault.getAllRewards();
      const claimedSigner = +utils.formatUnits(await Erc20Utils.balanceOf(rt, signer.address), rtDecimals) - rtBalanceSigner;
      claimedTotal += claimedSigner;
      expect(claimedSigner).is.greaterThan(0);
      expect(toClaimSigner).is.approximately(claimedSigner, claimedSigner * 0.01, 'signer claimed not enough ' + i);

      if (user1Deposited) {
        // test claim with exit
        await vault.connect(user1).exit();
        await VaultUtils.deposit(user1, vault, utils.parseUnits(user1Deposit, underlyingDec));
        const claimedUser1 = +utils.formatUnits(await Erc20Utils.balanceOf(rt, user1.address), rtDecimals) - rtBalanceUser1;
        claimedTotal += claimedUser1;
        expect(claimedUser1).is.greaterThan(0);
        expect(toClaimUser1).is.approximately(claimedUser1, claimedUser1 * 0.01, 'user1 claimed not enough ' + i);
      }

      if (user2Deposited) {
        await vault.connect(user2).getAllRewards();
        const claimedUser2 = +utils.formatUnits(await Erc20Utils.balanceOf(rt, user2.address), rtDecimals) - rtBalanceUser2;
        claimedTotal += claimedUser2;
        expect(claimedUser2).is.greaterThan(0);
        expect(toClaimUser2).is.approximately(claimedUser2, claimedUser2 * 0.01, 'user2 claimed not enough ' + i);
      }
      await Erc20Utils.transfer(underlying, signer, vault.address, utils.parseUnits(undSendPart, underlyingDec).toString());

      const ppfsAfter = +utils.formatUnits(await vault.getPricePerFullShare(), underlyingDec);
      console.log('ppfs change', ppfsAfter - ppfs)
    }

    console.log('claimedTotal', claimedTotal, +utils.formatUnits(rewardsTotalAmount, rtDecimals));
    expect(claimedTotal).is.approximately(+utils.formatUnits(rewardsTotalAmount, rtDecimals), claimedTotal * 0.01, 'total claimed not enough');

    await vault.exit();
  });


  it("check reward with transfers", async () => {

    const underlying = await UniswapUtils.addLiquidity(signer, MaticAddresses.WMATIC_TOKEN, MaticAddresses.USDC_TOKEN,
        utils.parseUnits('100000').toString(), utils.parseUnits('100000', 6).toString(),
        MaticAddresses.SUSHI_FACTORY, MaticAddresses.SUSHI_ROUTER);

    const rt = MaticAddresses.SUSHI_TOKEN;

    // ******** DEPLOY VAULT *******
    const vault = await DeployerUtils.deploySmartVault(signer);
    const strategy = await DeployerUtils.deployContract(signer, "NoopStrategy",
        core.controller.address, underlying, vault.address, [MaticAddresses.ZERO_ADDRESS], [MaticAddresses.WMATIC_TOKEN, MaticAddresses.USDC_TOKEN]) as NoopStrategy;
    await vault.initializeSmartVault(
        "NOOP",
        "tNOOP",
        core.controller.address,
        underlying,
        60 * 60 * 24 * 28
    );
    await core.controller.addVaultAndStrategy(vault.address, strategy.address);
    await vault.addRewardToken(rt);

    // ********** INIT VARS **************
    const user1 = (await ethers.getSigners())[1];
    const rtDecimals = await Erc20Utils.decimals(rt);
    const underlyingDec = await Erc20Utils.decimals(underlying);
    const duration = (await vault.duration()).toNumber();
    const time = 60 * 60 * 6;
    const rewardsTotalAmount = utils.parseUnits('10000', rtDecimals);

    console.log('underlying amount', utils.formatUnits(await Erc20Utils.balanceOf(underlying, signer.address), underlyingDec));

    await UniswapUtils.buyToken(signer, MaticAddresses.SUSHI_ROUTER, rt, utils.parseUnits('300'), MaticAddresses.WETH_TOKEN);
    await Erc20Utils.approve(rt, signer, vault.address, rewardsTotalAmount.toString());
    await vault.notifyTargetRewardAmount(rt, rewardsTotalAmount);


    const signerUndBal = +utils.formatUnits(await Erc20Utils.balanceOf(underlying, signer.address), underlyingDec);
    const signerDeposit = (signerUndBal).toFixed(underlyingDec);

    await VaultUtils.deposit(signer, vault, utils.parseUnits(signerDeposit, underlyingDec))

    const signerShareBal = await Erc20Utils.balanceOf(vault.address, signer.address);

    // clean address
    await Erc20Utils.transfer(rt, signer, core.controller.address, (await Erc20Utils.balanceOf(rt, signer.address)).toString());

    //*************** CYCLES *************
    let claimedTotal = 0;
    const cycles = duration / (time + 5);
    console.log('cycles', cycles);
    for (let i = 0; i < cycles; i++) {
      await TimeUtils.advanceBlocksOnTs(time / 2);

      // send a part of share to user1
      await Erc20Utils.transfer(vault.address, signer, user1.address,
          signerShareBal.div((cycles * 2).toFixed(0)).toString());

      const vaultRtBalance = +utils.formatUnits(await Erc20Utils.balanceOf(rt, vault.address), rtDecimals);

      const rtBalanceSigner = +utils.formatUnits(await Erc20Utils.balanceOf(rt, signer.address), rtDecimals);
      const rtBalanceUser1 = +utils.formatUnits(await Erc20Utils.balanceOf(rt, user1.address), rtDecimals);

      // signer claim
      const toClaimSigner = +utils.formatUnits(await vault.earned(rt, signer.address), rtDecimals);
      console.log('Signer toClaim', toClaimSigner, 'all rewards in vault', vaultRtBalance, 'rt balance', rtBalanceSigner);
      expect(toClaimSigner).is.greaterThan(0, 'to claim signer is zero ' + i);
      await vault.getAllRewards();

      await TimeUtils.advanceBlocksOnTs(time / 2);

      // user1 claim
      const toClaimUser1 = +utils.formatUnits(await vault.earned(rt, user1.address), rtDecimals);
      console.log('User1 toClaim', toClaimUser1, 'all rewards in vault', vaultRtBalance, 'rt balance', rtBalanceUser1);
      expect(toClaimUser1).is.greaterThan(0, 'to claim user1 is zero ' + i);
      await vault.connect(user1).getAllRewards();

      const claimedSigner = +utils.formatUnits(await Erc20Utils.balanceOf(rt, signer.address), rtDecimals) - rtBalanceSigner;
      console.log('claimedSigner', claimedSigner);
      claimedTotal += claimedSigner;

      const claimedUser1 = +utils.formatUnits(await Erc20Utils.balanceOf(rt, user1.address), rtDecimals) - rtBalanceUser1;
      console.log('claimedUser1', claimedUser1);
      claimedTotal += claimedUser1;


      expect(claimedSigner).is.greaterThan(0);
      expect(claimedUser1).is.greaterThan(0);
      expect(toClaimSigner).is.approximately(claimedSigner, claimedSigner * 0.01, 'signer claimed not enough ' + i);
      expect(toClaimUser1).is.approximately(claimedUser1, claimedUser1 * 0.01, 'user1 claimed not enough ' + i);
    }

    console.log('claimedTotal', claimedTotal, +utils.formatUnits(rewardsTotalAmount, rtDecimals));
    expect(claimedTotal).is.approximately(+utils.formatUnits(rewardsTotalAmount, rtDecimals), claimedTotal * 0.01, 'total claimed not enough');

    await vault.exit();
  });


});
