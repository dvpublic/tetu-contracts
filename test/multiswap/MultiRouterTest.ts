import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {
  MultiRouter,
} from "../../typechain";
import {ethers, web3, network} from "hardhat";
import {MaticAddresses} from "../../scripts/addresses/MaticAddresses";
import {DeployerUtils} from "../../scripts/deploy/DeployerUtils";
import {BigNumber, BigNumberish} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {
  loadAllPairs,
  Pair,
  saveObjectToJsonFile,
  indexAllPairs,
  findAllRoutes,
  extractPairsFromRoutes,
  loadReserves,
  MULTI_ROUTER_MATIC,
  calculateOutputs,
  sortRoutesByOutputs,
  getBestRoute,
  findBestWeights
} from "../../scripts/multiswap/MultiRouterLib";
import pairsJson from '../../scripts/multiswap/json/MultiRouterPairs.json'

const pairs = pairsJson as string[][]

const {expect} = chai;
chai.use(chaiAsPromised);

let signer: SignerWithAddress;
let multiRouter: MultiRouter;

describe("MultiRouter base tests", function () {

  before(async function () {
    signer = (await ethers.getSigners())[0];
    console.log('network.name', network.name);
    if (network.name === 'matic') {
      multiRouter = await DeployerUtils.connectInterface(signer, "MultiRouter", MULTI_ROUTER_MATIC) as MultiRouter
    } else if (network.name === 'hardhat') {
      multiRouter = await DeployerUtils.deployContract(signer, 'MultiRouter') as MultiRouter;
    } else
      console.error('Unsupported network', network.name)
  })

  after(async function () {
  });

  it("generateWays", async () => {
    console.time('indexAllPairs')
    const allPairs = indexAllPairs(pairs)
    console.timeEnd('indexAllPairs')
    console.log('pairs.length', pairs.length);
    console.log('keys allPairs.length', Object.keys(allPairs).length);

    console.time('findAllRoutes')
    const allRoutes = findAllRoutes(
        allPairs,
        // MaticAddresses.TETU_TOKEN, MaticAddresses.USDC_TOKEN,
        // MaticAddresses.USDC_TOKEN, MaticAddresses.USDC_TOKEN,
        // MaticAddresses.TETU_TOKEN, MaticAddresses.TETU_TOKEN,
        // MaticAddresses.WMATIC_TOKEN, MaticAddresses.WMATIC_TOKEN,
        MaticAddresses.AAVE_TOKEN, MaticAddresses.USDC_TOKEN,
        4)
    console.timeEnd('findAllRoutes')
    console.log('allRoutes', allRoutes);
    console.log('allRoutes.length', allRoutes.length);


    console.time('loadReserves')
    await loadReserves(multiRouter, allRoutes)
    console.timeEnd('loadReserves')

    const amountIn = ethers.utils.parseUnits('5000', 'ether')
    console.time('calculateOutputs')
    calculateOutputs(allRoutes, amountIn)
    console.timeEnd('calculateOutputs')

    sortRoutesByOutputs(allRoutes)
    console.log('allRoutes', allRoutes);

    const bestRoute = getBestRoute(allRoutes)
    console.log('bestRoute', bestRoute);

    console.time('findBestWeights')
    const bestWeights = findBestWeights(allRoutes, amountIn);
    console.timeEnd('findBestWeights')
    // console.log('Routes', allRoutes.slice(0,5));
    console.log('bestWeights', bestWeights);

  })


})
