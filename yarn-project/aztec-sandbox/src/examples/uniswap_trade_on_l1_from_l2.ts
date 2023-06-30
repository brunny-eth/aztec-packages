import {
  AztecRPC,
  Contract,
  ContractDeployer,
  TxStatus,
  createAccounts,
  createAztecRpcClient,
  getL1ContractAddresses,
  pointToPublicKey,
  AztecAddress,
  EthAddress,
  Fr,
} from '@aztec/aztec.js';
import { createDebugLogger } from '@aztec/foundation/log';
import { UniswapContractAbi } from '@aztec/noir-contracts/examples';
import { createPublicClient, createWalletClient, getContract, http, parseEther } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { delay, deployAndInitializeNonNativeL2TokenContracts, deployL1Contract } from './util.js';
import { UniswapPortalAbi, UniswapPortalBytecode } from '@aztec/l1-artifacts';

/**
 * Type representation of a Public key's coordinates.
 */
type PublicKey = {
  /** Public key X coord */
  x: bigint;
  /** Public key Y coord */
  y: bigint;
};

const logger = createDebugLogger('aztec:http-rpc-client');

export const MNEMONIC = 'test test test test test test test test test test test junk';

const INITIAL_BALANCE = 333n;
const wethAmountToBridge = parseEther('1');

const WETH9_ADDRESS = EthAddress.fromString('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
const DAI_ADDRESS = EthAddress.fromString('0x6B175474E89094C44Da98b954EedeAC495271d0F');

const EXPECTED_FORKED_BLOCK = 17514288;

const aztecRpcUrl = 'http://localhost:8080';
const ethRpcUrl = 'http://localhost:8545';

const hdAccount = mnemonicToAccount(MNEMONIC);
const privateKey = Buffer.from(hdAccount.getHdKey().privateKey!);

const walletClient = createWalletClient({
  account: hdAccount,
  chain: foundry,
  transport: http(ethRpcUrl),
});
const publicClient = createPublicClient({
  chain: foundry,
  transport: http(ethRpcUrl),
});

if (Number(await publicClient.getBlockNumber()) < EXPECTED_FORKED_BLOCK) {
  throw new Error('This test must be run on a fork of mainnet with the expected fork block');
}

const ethAccount = EthAddress.fromString((await walletClient.getAddresses())[0]);

const aztecRpcClient = createAztecRpcClient(aztecRpcUrl);

/**
 * Deploys all l1 / l2 contracts
 * @param ownerPub - Public key of deployer.
 */
async function deployAllContracts(ownerPub: PublicKey) {
  const l1ContractsAddresses = await getL1ContractAddresses(aztecRpcUrl);
  logger('Deploying DAI Portal, initializing and deploying l2 contract...');
  const daiContracts = await deployAndInitializeNonNativeL2TokenContracts(
    aztecRpcClient,
    walletClient,
    publicClient,
    l1ContractsAddresses!.registry,
    INITIAL_BALANCE,
    ownerPub,
    DAI_ADDRESS,
  );
  const daiL2Contract = daiContracts.l2Contract;
  const daiContract = daiContracts.underlyingERC20;
  const daiTokenPortalAddress = daiContracts.tokenPortalAddress;

  logger('Deploying WETH Portal, initializing and deploying l2 contract...');
  const wethContracts = await deployAndInitializeNonNativeL2TokenContracts(
    aztecRpcClient,
    walletClient,
    publicClient,
    l1ContractsAddresses!.registry,
    INITIAL_BALANCE,
    ownerPub,
    WETH9_ADDRESS,
  );
  const wethL2Contract = wethContracts.l2Contract;
  const wethContract = wethContracts.underlyingERC20;
  const wethTokenPortal = wethContracts.tokenPortal;
  const wethTokenPortalAddress = wethContracts.tokenPortalAddress;

  logger('Deploy Uniswap portal on L1 and L2...');
  const uniswapPortalAddress = await deployL1Contract(
    walletClient,
    publicClient,
    UniswapPortalAbi,
    UniswapPortalBytecode,
  );
  const uniswapPortal = getContract({
    address: uniswapPortalAddress.toString(),
    abi: UniswapPortalAbi,
    walletClient,
    publicClient,
  });

  // deploy l2 uniswap contract and attach to portal
  const deployer = new ContractDeployer(UniswapContractAbi, aztecRpcClient);
  const tx = deployer.deploy().send({ portalContract: uniswapPortalAddress });
  await tx.isMined(0, 0.5);
  const receipt = await tx.getReceipt();
  const uniswapL2Contract = new Contract(receipt.contractAddress!, UniswapContractAbi, aztecRpcClient);
  await uniswapL2Contract.attach(uniswapPortalAddress);

  await uniswapPortal.write.initialize(
    [l1ContractsAddresses!.registry.toString(), uniswapL2Contract.address.toString()],
    {} as any,
  );

  return {
    daiL2Contract,
    daiContract,
    daiTokenPortalAddress,
    wethL2Contract,
    wethContract,
    wethTokenPortal,
    wethTokenPortalAddress,
    uniswapL2Contract,
    uniswapPortal,
    uniswapPortalAddress,
  };
}

const getL2BalanceOf = async (aztecRpcClient: AztecRPC, owner: AztecAddress, l2Contract: any) => {
  const ownerPublicKey = await aztecRpcClient.getAccountPublicKey(owner);
  const [balance] = await l2Contract.methods.getBalance(pointToPublicKey(ownerPublicKey)).view({ from: owner });
  return balance;
};

const logExpectedBalanceOnL2 = async (
  aztecRpcClient: AztecRPC,
  owner: AztecAddress,
  expectedBalance: bigint,
  l2Contract: any,
) => {
  const balance = await getL2BalanceOf(aztecRpcClient, owner, l2Contract);
  logger(`Account ${owner} balance: ${balance}. Expected to be: ${expectedBalance}`);
};

const transferWethOnL2 = async (
  aztecRpcClient: AztecRPC,
  wethL2Contract: Contract,
  ownerAddress: AztecAddress,
  receiver: AztecAddress,
  transferAmount: bigint,
) => {
  const transferTx = wethL2Contract.methods
    .transfer(
      transferAmount,
      pointToPublicKey(await aztecRpcClient.getAccountPublicKey(ownerAddress)),
      pointToPublicKey(await aztecRpcClient.getAccountPublicKey(receiver)),
    )
    .send({ from: ownerAddress });
  await transferTx.isMined(0, 0.5);
  const transferReceipt = await transferTx.getReceipt();
  // expect(transferReceipt.status).toBe(TxStatus.MINED);
  logger(`WETH to L2 Transfer Receipt status: ${transferReceipt.status} should be ${TxStatus.MINED}`);
};

/**
 * main fn
 */
async function main() {
  logger('Running L1/L2 messaging test on HTTP interface.');

  const accounts = await createAccounts(aztecRpcClient, privateKey!, 2);
  const [[owner], [receiver]] = accounts;
  const ownerPub = pointToPublicKey(await aztecRpcClient.getAccountPublicKey(owner));

  const result = await deployAllContracts(ownerPub);
  const {
    daiL2Contract,
    daiContract,
    daiTokenPortalAddress,
    wethL2Contract,
    wethContract,
    wethTokenPortal,
    wethTokenPortalAddress,
    uniswapL2Contract,
    uniswapPortal,
    uniswapPortalAddress,
  } = result;

  // Give me some WETH so I can deposit to L2 and do the swap...
  logger('Getting some weth');
  await walletClient.sendTransaction({ to: WETH9_ADDRESS.toString(), value: parseEther('1') });

  const meBeforeBalance = await wethContract.read.balanceOf([ethAccount.toString()]);
  // 1. Approve weth to be bridged
  await wethContract.write.approve([wethTokenPortalAddress.toString(), wethAmountToBridge], {} as any);

  // 2. Deposit weth into the portal and move to L2
  // generate secret
  const secret = Fr.random();
  const secretHash = await aztecRpcClient.getMessageHash(secret);
  const secretString = `0x${secretHash.toBuffer().toString('hex')}` as `0x${string}`;
  const deadline = 2 ** 32 - 1; // max uint32 - 1
  logger('Sending messages to L1 portal');
  const args = [owner.toString(), wethAmountToBridge, deadline, secretString, ethAccount.toString()] as const;
  const { result: messageKeyHex } = await wethTokenPortal.simulate.depositToAztec(args, {
    account: ethAccount.toString(),
  } as any);
  await wethTokenPortal.write.depositToAztec(args, {} as any);
  // expect(await wethContract.read.balanceOf([ethAccount.toString()])).toBe(meBeforeBalance - wethAmountToBridge);

  const currentBalance = await wethContract.read.balanceOf([ethAccount.toString()]);
  logger(`Current Balance: ${currentBalance}. Should be: ${meBeforeBalance - wethAmountToBridge}`);
  const messageKey = Fr.fromString(messageKeyHex);

  // Wait for the archiver to process the message
  await delay(5000);
  // send a transfer tx to force through rollup with the message included
  const transferAmount = 1n;
  await transferWethOnL2(aztecRpcClient, wethL2Contract, owner, receiver, transferAmount);

  // 3. Claim WETH on L2
  logger('Minting weth on L2');
  // Call the mint tokens function on the noir contract
  const consumptionTx = wethL2Contract.methods
    .mint(wethAmountToBridge, ownerPub, owner, messageKey, secret, ethAccount.toField())
    .send({ from: owner });
  await consumptionTx.isMined(0, 0.5);
  const consumptionReceipt = await consumptionTx.getReceipt();
  // expect(consumptionReceipt.status).toBe(TxStatus.MINED);
  logger(`Consumption Receipt status: ${consumptionReceipt.status} should be ${TxStatus.MINED}`);
  // await expectBalanceOnL2(ownerAddress, wethAmountToBridge + initialBalance - transferAmount, wethL2Contract);

  // Store balances
  const wethBalanceBeforeSwap = await getL2BalanceOf(aztecRpcClient, owner, wethL2Contract);
  const daiBalanceBeforeSwap = await getL2BalanceOf(aztecRpcClient, owner, daiL2Contract);

  // 4. Send L2 to L1 message to withdraw funds and another message to swap assets.
  logger('Send L2 tx to withdraw WETH to uniswap portal and send message to swap assets on L1');
  // recipient is the uniswap portal
  const selector = Fr.fromBuffer(wethL2Contract.methods.withdraw.selector);
  const minimumOutputAmount = 0n;

  const withdrawTx = uniswapL2Contract.methods
    .swap(
      selector,
      wethL2Contract.address.toField(),
      wethTokenPortalAddress.toField(),
      wethAmountToBridge,
      new Fr(3000),
      daiL2Contract.address.toField(),
      daiTokenPortalAddress.toField(),
      new Fr(minimumOutputAmount),
      ownerPub,
      owner,
      secretHash,
      new Fr(2 ** 32 - 1),
      ethAccount.toField(),
      uniswapPortalAddress,
      ethAccount.toField(),
    )
    .send({ from: owner });
  await withdrawTx.isMined(0, 0.5);
  const withdrawReceipt = await withdrawTx.getReceipt();
  // expect(withdrawReceipt.status).toBe(TxStatus.MINED);
  logger(`Withdraw receipt status: ${withdrawReceipt.status} should be ${TxStatus.MINED}`);

  // check weth balance of owner on L2 (we first briedged `wethAmountToBridge` into L2 and now withdrew it!)
  await logExpectedBalanceOnL2(aztecRpcClient, owner, INITIAL_BALANCE - transferAmount, wethL2Contract);

  // 5. Consume L2 to L1 message by calling uniswapPortal.swap()
  logger('Execute withdraw and swap on the uniswapPortal!');
  const daiBalanceOfPortalBefore = await daiContract.read.balanceOf([daiTokenPortalAddress.toString()]);
  logger(`DAI balance of portal: ${daiBalanceOfPortalBefore}`);
  const swapArgs = [
    wethTokenPortalAddress.toString(),
    wethAmountToBridge,
    3000,
    daiTokenPortalAddress.toString(),
    minimumOutputAmount,
    owner.toString(),
    secretString,
    deadline,
    ethAccount.toString(),
    true,
  ] as const;
  const { result: depositDaiMessageKeyHex } = await uniswapPortal.simulate.swap(swapArgs, {
    account: ethAccount.toString(),
  } as any);
  // this should also insert a message into the inbox.
  await uniswapPortal.write.swap(swapArgs, {} as any);
  const depositDaiMessageKey = Fr.fromString(depositDaiMessageKeyHex);
  // weth was swapped to dai and send to portal
  const daiBalanceOfPortalAfter = await daiContract.read.balanceOf([daiTokenPortalAddress.toString()]);
  // expect(daiBalanceOfPortalAfter).toBeGreaterThan(daiBalanceOfPortalBefore);
  logger(
    `DAI balance in Portal: ${daiBalanceOfPortalAfter} should be bigger than ${daiBalanceOfPortalBefore}. ${
      daiBalanceOfPortalAfter > daiBalanceOfPortalBefore
    }`,
  );
  const daiAmountToBridge = daiBalanceOfPortalAfter - daiBalanceOfPortalBefore;

  // Wait for the archiver to process the message
  await delay(5000);
  // send a transfer tx to force through rollup with the message included
  await transferWethOnL2(aztecRpcClient, wethL2Contract, owner, receiver, transferAmount);

  // 6. claim dai on L2
  logger('Consuming messages to mint dai on L2');
  // Call the mint tokens function on the noir contract
  const daiMintTx = daiL2Contract.methods
    .mint(daiAmountToBridge, ownerPub, owner, depositDaiMessageKey, secret, ethAccount.toField())
    .send({ from: owner });
  await daiMintTx.isMined(0, 0.5);
  const daiMintTxReceipt = await daiMintTx.getReceipt();
  // expect(daiMintTxReceipt.status).toBe(TxStatus.MINED);
  logger(`DAI mint TX status: ${daiMintTxReceipt.status} should be ${TxStatus.MINED}`);
  await logExpectedBalanceOnL2(aztecRpcClient, owner, INITIAL_BALANCE + BigInt(daiAmountToBridge), daiL2Contract);

  const wethBalanceAfterSwap = await getL2BalanceOf(aztecRpcClient, owner, wethL2Contract);
  const daiBalanceAfterSwap = await getL2BalanceOf(aztecRpcClient, owner, daiL2Contract);

  logger('WETH balance before swap: ', wethBalanceBeforeSwap.toString());
  logger('DAI balance before swap  : ', daiBalanceBeforeSwap.toString());
  logger('***** 🧚‍♀️ SWAP L2 assets on L1 Uniswap 🧚‍♀️ *****');
  logger('WETH balance after swap : ', wethBalanceAfterSwap.toString());
  logger('DAI balance after swap  : ', daiBalanceAfterSwap.toString());
}

main()
  .then(() => {
    logger('Finished running successfuly.');
    process.exit(0);
  })
  .catch(err => {
    logger('Error in main fn: ', err);
    process.exit(1);
  });
