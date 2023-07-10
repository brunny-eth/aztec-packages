import { AztecNodeService } from '@aztec/aztec-node';
import {
  AztecAddress,
  AztecRPCServer,
  Contract,
  ContractDeployer,
  CurveType,
  Fr,
  Point,
  SentTx,
  SignerType,
} from '@aztec/aztec.js';
import {
  MultiTransferContractAbi,
  GullibleAccountContractAbi,
  ZkTokenContractAbi,
} from '@aztec/noir-contracts/examples';
import { DebugLogger } from '@aztec/foundation/log';

import { pointToPublicKey, setup } from './utils.js';

describe('multi-transfer payments', () => {
  let aztecNode: AztecNodeService;
  let aztecRpcServer: AztecRPCServer;
  let accounts: AztecAddress[];
  let logger: DebugLogger;
  let owner: Point;
  let ownerAddress: AztecAddress;

  let contract: Contract;

  beforeEach(async () => {
    ({ aztecNode, aztecRpcServer, accounts, logger } = await setup(2));
    owner = await aztecRpcServer.getAccountPublicKey(accounts[0]);
    ownerAddress = accounts[0];
  }, 100_000);

  afterEach(async () => {
    await aztecNode?.stop();
    await aztecRpcServer?.stop();
  });

  const deployContract = async (initialNote1 = 0n, owner = { x: 0n, y: 0n }) => {
    logger(`Deploying token contract...`);
    const deployer = new ContractDeployer(ZkTokenContractAbi, aztecRpcServer);
    const tx = deployer.deploy(initialNote1, owner).send();
    const receipt = await tx.getReceipt();
    contract = new Contract(receipt.contractAddress!, ZkTokenContractAbi, aztecRpcServer);
    await tx.isMined(0, 0.1);
    await tx.getReceipt();
    logger('L2 contract deployed');
    return contract;
  };

  const deployMultiTransferContract = async () => {
    logger(`Deploying multiTransfer contract...`);
    const deployer = new ContractDeployer(MultiTransferContractAbi, aztecRpcServer);
    const tx = deployer.deploy().send();
    const receipt = await tx.getReceipt();
    contract = new Contract(receipt.contractAddress!, MultiTransferContractAbi, aztecRpcServer);
    await tx.isMined(0, 0.1);
    await tx.getReceipt();
    logger('L2 contract deployed');
    return contract;
  };

  const expectBalance = async (tokenContract: Contract, owner: AztecAddress, expectedBalance: bigint) => {
    const ownerPublicKey = await aztecRpcServer.getAccountPublicKey(owner);
    const [balance] = await tokenContract.methods.getBalance(pointToPublicKey(ownerPublicKey)).view({ from: owner });
    logger(`Account ${owner} balance: ${balance}`);
    expect(balance).toBe(expectedBalance);
  };

  const createAccounts = async (numberOfAccounts: number) => {
    const points: Point[] = [];

    for (let i = 0; i < numberOfAccounts; ++i) {
      // We use the well-known private key and the validating account contract for the first account,
      // and generate random keypairs with gullible account contracts (ie no sig validation) for the rest.
      // TODO(#662): Let the aztec rpc server generate the keypair rather than hardcoding the private key
      const [privKey, impl] = [undefined, GullibleAccountContractAbi];
      const [txHash, newAddress] = await aztecRpcServer.createSmartAccount(
        privKey,
        CurveType.GRUMPKIN,
        SignerType.SCHNORR,
        impl,
      );
      const isMined = await new SentTx(aztecRpcServer, Promise.resolve(txHash)).isMined();
      expect(isMined).toBeTruthy();
      const address = newAddress;
      const pubKey = await aztecRpcServer.getAccountPublicKey(address);
      points.push(pubKey);
      logger(`Created account ${address.toString()} with public key ${pubKey.toString()}`);
    }
    return points;
  };

  it('12 transfers per transactions should work PLEASE WORK', async () => {
    const initialNote = 1000n;

    logger(`Deploying L2 contract...`);
    const zkContract = await deployContract(initialNote, pointToPublicKey(owner));
    const multiTransferContract = await deployMultiTransferContract();

    logger(`split the large note into four notes for the owner`);
    const batchTransferRecipients = [
      new Point(owner.x, owner.x),
      new Point(owner.x, owner.y),
      new Point(owner.y, owner.y),
    ];
    const batchTransferTx = zkContract.methods
      .batchTransfer(owner, [400n, 300n, 200n], batchTransferRecipients, 0)
      .send({ from: ownerAddress });
    await batchTransferTx.isMined(0, 0.5);
    const batchTransferTxReceipt = await batchTransferTx.getReceipt();
    logger(`consumption Receipt status: ${batchTransferTxReceipt.status}`);
    await expectBalance(zkContract, ownerAddress, initialNote);

    logger(`create some user accounts`);
    const numberOfAccounts = 6;
    const points = await createAccounts(numberOfAccounts);

    const amounts: bigint[] = [50n, 50n, 50n, 20n, 20n, 20n, 15n, 15n, 15n, 30n, 30n, 30n];
    const amountSum = amounts.reduce((a, b) => a + b, 0n);

    logger(`multiTransfer()...`);
    // Send all the 6 employees 2 notes each
    // TODO: correct the "points"
    const multiTransferTx = multiTransferContract.methods
      .multiTransfer(
        zkContract.address.toField(),
        points.concat(points),
        amounts,
        owner,
        Fr.fromBuffer(zkContract.methods.batchTransfer.selector),
      )
      .send({ from: ownerAddress });
    await multiTransferTx.isMined(0, 0.5);
    const multiTransferTxReceipt = await multiTransferTx.getReceipt();
    logger(`Consumption Receipt status: ${multiTransferTxReceipt.status}`);
    await expectBalance(zkContract, ownerAddress, initialNote - amountSum);
  }, 240_000);

  it.skip('12 transfers per transactions should work', async () => {
    const initialNote1 = 30n;
    const initialNote2 = 45n;
    const initialNote3 = 60n;
    const initialNote4 = 75n;

    logger(`Deploying L2 contract...`);
    const zkContract = await deployContract(initialNote1, pointToPublicKey(owner));
    const multiTransferContract = await deployMultiTransferContract();

    // We need to first create 4 notes for the owner and get those in the private data tree.
    // This is because until we have those trees in the private data tree, we cannot spend them (atleast until we support pending commitments).
    // That means we need the transactions to mint these notes to be settled and only then we can test multi-transfer.
    logger(`mint the second note`);
    {
      const tx = zkContract.methods.mint(initialNote2, owner).send({ from: ownerAddress });
      await tx.isMined(0, 0.5);
      await tx.getReceipt();
      await expectBalance(zkContract, ownerAddress, initialNote1 + initialNote2);
    }
    logger(`mint the third note`);
    {
      const tx = zkContract.methods.mint(initialNote3, owner).send({ from: ownerAddress });
      await tx.isMined(0, 0.5);
      await tx.getReceipt();
      await expectBalance(zkContract, ownerAddress, initialNote1 + initialNote2 + initialNote3);
    }
    logger(`mint the fourth note`);
    {
      const tx = zkContract.methods.mint(initialNote4, owner).send({ from: ownerAddress });
      await tx.isMined(0, 0.5);
      await tx.getReceipt();
      await expectBalance(zkContract, ownerAddress, initialNote1 + initialNote2 + initialNote3 + initialNote4);
    }

    logger(`create some user accounts`);
    const numberOfAccounts = 12;
    const points = await createAccounts(numberOfAccounts);

    const amounts: bigint[] = [5n, 5n, 5n, 10n, 10n, 10n, 15n, 15n, 15n, 20n, 20n, 20n];
    const amountSum = amounts.reduce((a, b) => a + b, 0n);

    logger(`multiTransfer()...`);
    const multiTransferTx = multiTransferContract.methods
      .multiTransfer(
        zkContract.address.toField(),
        points,
        amounts,
        owner,
        Fr.fromBuffer(zkContract.methods.batchTransfer.selector),
      )
      .send({ from: ownerAddress });
    await multiTransferTx.isMined(0, 0.5);
    const multiTransferTxReceipt = await multiTransferTx.getReceipt();
    logger(`Consumption Receipt status: ${multiTransferTxReceipt.status}`);
    await expectBalance(
      zkContract,
      ownerAddress,
      initialNote1 + initialNote2 + initialNote3 + initialNote4 - amountSum,
    );
  }, 240_000);
});
