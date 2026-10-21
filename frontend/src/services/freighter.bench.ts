import { describe, bench } from 'vitest';
import { rpc, TransactionBuilder, Networks } from '@stellar/stellar-sdk';

describe('Transaction Preparation Benchmark', () => {
  const transaction = new TransactionBuilder(
    // `TransactionBuilder` needs a resolved account source. The benchmark only
    // measures the local assembly cost, so a stub account is enough.
    {
      accountId: () => 'GBTEST',
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => '0',
    },
    { fee: '100', networkPassphrase: Networks.TESTNET },
  ).build();

  const mockSimulation = {
    results: [],
    latestLedger: 123456,
  };

  bench('server.prepareTransaction (Legacy / Network bound)', async () => {
    // This is mocked to show intention, normally requires network fetching
    // await server.prepareTransaction(transaction);
  });

  bench('rpc.assembleTransaction (Optimized / Local)', async () => {
    // Local assembly using existing simulation results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK does not export the simulation response type
    rpc.assembleTransaction(transaction, mockSimulation as any).build();
  });
});
