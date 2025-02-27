import { AztecAddress } from '@aztec/foundation/aztec-address';
import { EthAddress } from '@aztec/foundation/eth-address';
import { Fr } from '@aztec/foundation/fields';
import { sleep } from '@aztec/foundation/sleep';
import { ContractDeploymentEmitterAbi, InboxAbi, RollupAbi } from '@aztec/l1-artifacts';
import { ExtendedContractData, L2Block, L2BlockL2Logs, LogType } from '@aztec/types';

import { MockProxy, mock } from 'jest-mock-extended';
import { Chain, HttpTransport, Log, PublicClient, Transaction, encodeFunctionData, toHex } from 'viem';

import { Archiver } from './archiver.js';
import { ArchiverDataStore, MemoryArchiverStore } from './archiver_store.js';

describe('Archiver', () => {
  const rollupAddress = EthAddress.ZERO.toString();
  const inboxAddress = EthAddress.ZERO.toString();
  const registryAddress = EthAddress.ZERO.toString();
  const contractDeploymentEmitterAddress = '0x0000000000000000000000000000000000000001';
  const blockNums = [1, 2, 3];
  let publicClient: MockProxy<PublicClient<HttpTransport, Chain>>;
  let archiverStore: ArchiverDataStore;

  beforeEach(() => {
    publicClient = mock<PublicClient<HttpTransport, Chain>>();
    archiverStore = new MemoryArchiverStore();
  });

  it('can start, sync and stop and handle l1 to l2 messages and logs', async () => {
    const archiver = new Archiver(
      publicClient,
      EthAddress.fromString(rollupAddress),
      EthAddress.fromString(inboxAddress),
      EthAddress.fromString(registryAddress),
      EthAddress.fromString(contractDeploymentEmitterAddress),
      0,
      archiverStore,
      1000,
    );

    let latestBlockNum = await archiver.getBlockNumber();
    expect(latestBlockNum).toEqual(0);

    const blocks = blockNums.map(x => L2Block.random(x, 4, x, x + 1, x * 2, x * 3));
    const rollupTxs = blocks.map(makeRollupTx);
    // `L2Block.random(x)` creates some l1 to l2 messages. We add those,
    // since it is expected by the test that these would be consumed.
    // Archiver removes such messages from pending store.
    // Also create some more messages to cancel and some that will stay pending.

    const messageToCancel1 = Fr.random().toString(true);
    const messageToCancel2 = Fr.random().toString(true);
    const l1ToL2MessagesToCancel = [messageToCancel1, messageToCancel2];
    const messageToStayPending1 = Fr.random().toString(true);
    const messageToStayPending2 = Fr.random().toString(true);

    const l1ToL2MessageAddedEvents = [
      makeL1ToL2MessageAddedEvents(
        100n,
        blocks[0].newL1ToL2Messages.map(key => key.toString(true)),
      ),
      makeL1ToL2MessageAddedEvents(
        100n,
        blocks[1].newL1ToL2Messages.map(key => key.toString(true)),
      ),
      makeL1ToL2MessageAddedEvents(
        2501n,
        blocks[2].newL1ToL2Messages.map(key => key.toString(true)),
      ),
      makeL1ToL2MessageAddedEvents(2502n, [
        messageToCancel1,
        messageToCancel2,
        messageToStayPending1,
        messageToStayPending2,
      ]),
    ];
    publicClient.getBlockNumber.mockResolvedValueOnce(2500n).mockResolvedValueOnce(2600n).mockResolvedValueOnce(2700n);
    // logs should be created in order of how archiver syncs.
    publicClient.getLogs
      .mockResolvedValueOnce(l1ToL2MessageAddedEvents.slice(0, 2).flat())
      .mockResolvedValueOnce([]) // no messages to cancel
      .mockResolvedValueOnce([makeL2BlockProcessedEvent(101n, 1n)])
      .mockResolvedValueOnce([makeContractDeploymentEvent(103n, blocks[0])]) // the first loop of the archiver ends here at block 2500
      .mockResolvedValueOnce(l1ToL2MessageAddedEvents.slice(2, 4).flat())
      .mockResolvedValueOnce(makeL1ToL2MessageCancelledEvents(2503n, l1ToL2MessagesToCancel))
      .mockResolvedValueOnce([makeL2BlockProcessedEvent(2510n, 2n), makeL2BlockProcessedEvent(2520n, 3n)])
      .mockResolvedValueOnce([makeContractDeploymentEvent(2540n, blocks[1])])
      .mockResolvedValue([]);
    rollupTxs.forEach(tx => publicClient.getTransaction.mockResolvedValueOnce(tx));

    await archiver.start(false);

    // Wait until block 3 is processed. If this won't happen the test will fail with timeout.
    while ((await archiver.getBlockNumber()) !== 3) {
      await sleep(100);
    }

    latestBlockNum = await archiver.getBlockNumber();
    expect(latestBlockNum).toEqual(3);

    // Check that only 2 messages (l1ToL2MessageAddedEvents[3][2] and l1ToL2MessageAddedEvents[3][3]) are pending.
    // Other two (l1ToL2MessageAddedEvents[3][0..2]) were cancelled. And the previous messages were confirmed.
    const expectedPendingMessageKeys = [
      l1ToL2MessageAddedEvents[3][2].args.entryKey,
      l1ToL2MessageAddedEvents[3][3].args.entryKey,
    ];
    const actualPendingMessageKeys = (await archiver.getPendingL1ToL2Messages(10)).map(key => key.toString(true));
    expect(expectedPendingMessageKeys).toEqual(actualPendingMessageKeys);

    // Expect logs to correspond to what is set by L2Block.random(...)
    const encryptedLogs = await archiver.getLogs(1, 100, LogType.ENCRYPTED);
    expect(encryptedLogs.length).toEqual(blockNums.length);

    for (const [index, x] of blockNums.entries()) {
      const expectedTotalNumEncryptedLogs = 4 * x * (x * 2);
      const totalNumEncryptedLogs = L2BlockL2Logs.unrollLogs([encryptedLogs[index]]).length;
      expect(totalNumEncryptedLogs).toEqual(expectedTotalNumEncryptedLogs);
    }

    const unencryptedLogs = await archiver.getLogs(1, 100, LogType.UNENCRYPTED);
    expect(unencryptedLogs.length).toEqual(blockNums.length);

    blockNums.forEach((x, index) => {
      const expectedTotalNumUnencryptedLogs = 4 * (x + 1) * (x * 3);
      const totalNumUnencryptedLogs = L2BlockL2Logs.unrollLogs([unencryptedLogs[index]]).length;
      expect(totalNumUnencryptedLogs).toEqual(expectedTotalNumUnencryptedLogs);
    });

    await archiver.stop();
  }, 10_000);

  it('does not sync past current block number', async () => {
    const numL2BlocksInTest = 2;
    const archiver = new Archiver(
      publicClient,
      EthAddress.fromString(rollupAddress),
      EthAddress.fromString(inboxAddress),
      EthAddress.fromString(registryAddress),
      EthAddress.fromString(contractDeploymentEmitterAddress),
      0,
      archiverStore,
      1000,
    );

    let latestBlockNum = await archiver.getBlockNumber();
    expect(latestBlockNum).toEqual(0);

    const createL1ToL2Messages = () => {
      return [Fr.random().toString(true), Fr.random().toString(true)];
    };

    const blocks = blockNums.map(x => L2Block.random(x, 4, x, x + 1, x * 2, x * 3));
    const rollupTxs = blocks.map(makeRollupTx);
    // `L2Block.random(x)` creates some l1 to l2 messages. We add those,
    // since it is expected by the test that these would be consumed.
    // Archiver removes such messages from pending store.
    // Also create some more messages to cancel and some that will stay pending.

    const additionalL1ToL2MessagesBlock102 = createL1ToL2Messages();
    const additionalL1ToL2MessagesBlock103 = createL1ToL2Messages();

    const l1ToL2MessageAddedEvents = [
      makeL1ToL2MessageAddedEvents(
        100n,
        blocks[0].newL1ToL2Messages.map(key => key.toString(true)),
      ),
      makeL1ToL2MessageAddedEvents(
        101n,
        blocks[1].newL1ToL2Messages.map(key => key.toString(true)),
      ),
      makeL1ToL2MessageAddedEvents(102n, additionalL1ToL2MessagesBlock102),
      makeL1ToL2MessageAddedEvents(103n, additionalL1ToL2MessagesBlock103),
    ];

    // Here we set the current L1 block number to 102. L1 to L2 messages after this should not be read.
    publicClient.getBlockNumber.mockResolvedValue(102n);
    // add all of the L1 to L2 messages to the mock
    publicClient.getLogs
      .mockImplementationOnce((args?: any) => {
        return Promise.resolve(
          l1ToL2MessageAddedEvents
            .flat()
            .filter(x => x.blockNumber! >= args.fromBlock && x.blockNumber! < args.toBlock),
        );
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeL2BlockProcessedEvent(70n, 1n), makeL2BlockProcessedEvent(80n, 2n)])
      .mockResolvedValue([]);
    rollupTxs.slice(0, numL2BlocksInTest).forEach(tx => publicClient.getTransaction.mockResolvedValueOnce(tx));

    await archiver.start(false);

    // Wait until block 3 is processed. If this won't happen the test will fail with timeout.
    while ((await archiver.getBlockNumber()) !== numL2BlocksInTest) {
      await sleep(100);
    }

    latestBlockNum = await archiver.getBlockNumber();
    expect(latestBlockNum).toEqual(numL2BlocksInTest);

    // Check that the only pending L1 to L2 messages are those from eth bock 102
    const expectedPendingMessageKeys = additionalL1ToL2MessagesBlock102;
    const actualPendingMessageKeys = (await archiver.getPendingL1ToL2Messages(100)).map(key => key.toString(true));
    expect(actualPendingMessageKeys).toEqual(expectedPendingMessageKeys);

    await archiver.stop();
  }, 10_000);
});

/**
 * Makes a fake L2BlockProcessed event for testing purposes.
 * @param l1BlockNum - L1 block number.
 * @param l2BlockNum - L2Block number.
 * @returns An L2BlockProcessed event log.
 */
function makeL2BlockProcessedEvent(l1BlockNum: bigint, l2BlockNum: bigint) {
  return {
    blockNumber: l1BlockNum,
    args: { blockNum: l2BlockNum },
    transactionHash: `0x${l2BlockNum}`,
  } as Log<bigint, number, undefined, true, typeof RollupAbi, 'L2BlockProcessed'>;
}

/**
 * Makes a fake ContractDeployment event for testing purposes.
 * @param l1BlockNum - L1 block number.
 * @param l2Block - The l2Block this event is associated with.
 * @returns An ContractDeployment event.
 */
function makeContractDeploymentEvent(l1BlockNum: bigint, l2Block: L2Block) {
  const extendedContractData = ExtendedContractData.random();
  const acir = extendedContractData.bytecode?.toString('hex');
  return {
    blockNumber: l1BlockNum,
    args: {
      l2BlockNum: BigInt(l2Block.number),
      aztecAddress: extendedContractData.contractData.contractAddress.toString(),
      portalAddress: extendedContractData.contractData.portalContractAddress.toString(),
      l2BlockHash: `0x${l2Block.getCalldataHash().toString('hex')}`,
      partialAddress: extendedContractData.partialAddress.toString(true),
      pubKeyX: extendedContractData.publicKey.x.toString(true),
      pubKeyY: extendedContractData.publicKey.y.toString(true),
      acir: '0x' + acir,
    },
    transactionHash: `0x${l2Block.number}`,
  } as Log<bigint, number, undefined, true, typeof ContractDeploymentEmitterAbi, 'ContractDeployment'>;
}

/**
 * Makes fake L1ToL2 MessageAdded events for testing purposes.
 * @param l1BlockNum - L1 block number.
 * @param entryKeys - The entry keys of the messages to add.
 * @returns MessageAdded event logs.
 */
function makeL1ToL2MessageAddedEvents(l1BlockNum: bigint, entryKeys: string[]) {
  return entryKeys.map(entryKey => {
    return {
      blockNumber: l1BlockNum,
      args: {
        sender: EthAddress.random().toString(),
        senderChainId: 1n,
        recipient: AztecAddress.random().toString(),
        recipientVersion: 1n,
        content: Fr.random().toString(true),
        secretHash: Fr.random().toString(true),
        deadline: 100,
        fee: 1n,
        entryKey: entryKey,
      },
      transactionHash: `0x${l1BlockNum}`,
    } as Log<bigint, number, undefined, true, typeof InboxAbi, 'MessageAdded'>;
  });
}

/**
 * Makes fake L1ToL2 MessageCancelled events for testing purposes.
 * @param l1BlockNum - L1 block number.
 * @param entryKey - The entry keys of the message to cancel.
 * @returns MessageCancelled event logs.
 */
function makeL1ToL2MessageCancelledEvents(l1BlockNum: bigint, entryKeys: string[]) {
  return entryKeys.map(entryKey => {
    return {
      blockNumber: l1BlockNum,
      args: {
        entryKey,
      },
      transactionHash: `0x${l1BlockNum}`,
    } as Log<bigint, number, undefined, true, typeof InboxAbi, 'L1ToL2MessageCancelled'>;
  });
}

/**
 * Makes a fake rollup tx for testing purposes.
 * @param block - The L2Block.
 * @returns A fake tx with calldata that corresponds to calling process in the Rollup contract.
 */
function makeRollupTx(l2Block: L2Block) {
  const proof = `0x`;
  const block = toHex(l2Block.toBufferWithLogs());
  const input = encodeFunctionData({ abi: RollupAbi, functionName: 'process', args: [proof, block] });
  return { input } as Transaction<bigint, number>;
}
