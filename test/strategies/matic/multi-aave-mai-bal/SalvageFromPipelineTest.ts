import {SpecificStrategyTest} from "../../SpecificStrategyTest";
import {utils} from "ethers";
import {TokenUtils} from "../../../TokenUtils";
import {StrategyAaveMaiBal} from "../../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {DeployInfo} from "../../DeployInfo";
import {MaticAddresses} from "../../../../scripts/addresses/MaticAddresses";
import {UniswapUtils} from "../../../UniswapUtils";

const {expect} = chai;
chai.use(chaiAsPromised);

export class SalvageFromPipelineTest extends SpecificStrategyTest {

  public async do(
    deployInfo: DeployInfo
  ): Promise<void> {
    it("Salvage from pipeline", async () => {
      const signer = deployInfo?.signer as SignerWithAddress;

      const strategyAaveMaiBal = deployInfo.strategy as StrategyAaveMaiBal;

      console.log('>>>Salvage from pipeline test');
      const strategyGov = strategyAaveMaiBal.connect(signer);
      const token = MaticAddresses.DAI_TOKEN; // token to test salvage, 18 decimals
      const pipesLength = await strategyGov.pipesLength();
      console.log('>>>pipesLength  ', pipesLength.toString());
      const amountPerPipe = utils.parseUnits('1')
      console.log('>>>amountPerPipe', amountPerPipe.toString());
      const totalAmount = amountPerPipe.mul(pipesLength)
      console.log('>>>totalAmount  ', totalAmount.toString());
      await UniswapUtils.buyToken(signer, MaticAddresses.SUSHI_ROUTER,
        token, totalAmount);

      const balanceAfterBuy = await TokenUtils.balanceOf(token, signer.address)
      console.log('>>>balanceAfterBuy', balanceAfterBuy.toString());

      for (let i = 0; i < pipesLength.toNumber(); i++) {
        const pipe = await strategyGov.pipes(i);
        await TokenUtils.transfer(token, signer, pipe, amountPerPipe.toString());
      }

      const balanceBefore = await TokenUtils.balanceOf(token, signer.address)
      console.log('>>>balanceBefore', balanceBefore);

      await strategyGov.salvageFromPipeline(signer.address, token);

      const balanceAfter = await TokenUtils.balanceOf(token, signer.address)
      console.log('>>>balanceAfter ', balanceAfter);

      const increase = balanceAfter.sub(balanceBefore)
      console.log('>>>increase     ', increase);

      expect(increase).to.be.equal(totalAmount);
    });
  }

}