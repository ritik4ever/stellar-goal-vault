import { createHash } from 'crypto';
import { createServer, type Server } from 'http';
import * as StellarSdk from '../../frontend/node_modules/@stellar/stellar-sdk';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Deterministic, structurally valid Soroban contract id (C… strkey). */
export const MOCK_CONTRACT_ID = StellarSdk.StrKey.encodeContract(new Uint8Array(32).fill(7));

/** Stable hex hash used for submitted transactions (matches TX_HASH_REGEX). */
export const MOCK_TX_HASH = 'ab'.repeat(32);

interface JsonRpcBody {
  id: number | string | null;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Builds the base64 XDR of an account ledger entry for `address`, matching the
 * shape `rpc.Server.getAccount` decodes (`getLedgerEntries` → `LedgerEntryData`).
 */
function accountEntryXdr(address: string): string {
  const pk = StellarSdk.Keypair.fromPublicKey(address).xdrPublicKey();
  return StellarSdk.xdr.LedgerEntryData.account(
    new StellarSdk.xdr.AccountEntry({
      accountId: pk,
      balance: StellarSdk.xdr.Int64('10000000000'),
      seqNum: StellarSdk.xdr.Int64('100'),
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: '',
      thresholds: new StellarSdk.xdr.Thresholds(new Uint8Array([1, 0, 0, 0])),
      signers: [],
      ext: StellarSdk.xdr.ExtensionPoint.v0(),
    }),
  ).toXDR('base64');
}

/** Empty-but-valid Soroban transaction data (footprint + resource fee). */
function emptySorobanDataXdr(): string {
  return new StellarSdk.xdr.SorobanTransactionData({
    resources: new StellarSdk.xdr.SorobanResources({
      footprint: new StellarSdk.xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
      instructions: 0,
      diskReadBytes: 0,
      writeBytes: 0,
    }),
    ext: StellarSdk.xdr.SorobanTransactionDataExt.v0(),
    resourceFee: StellarSdk.xdr.Int64('600'),
  }).toXDR('base64');
}

/** Minimal successful transaction result (txSUCCESS, no operation results). */
function txResultXdr(): string {
  const TransactionResultResult = (
    StellarSdk.xdr as unknown as {
      TransactionResultResultTxSuccess: new (results: unknown[]) => unknown;
    }
  ).TransactionResultResultTxSuccess;
  return new StellarSdk.xdr.TransactionResult({
    feeCharged: StellarSdk.xdr.Int64('100'),
    result: new TransactionResultResult([]) as never,
    ext: StellarSdk.xdr.TransactionResultExt.v0(),
  }).toXDR('base64');
}

/** TransactionMeta v3 arm — the parser requires `meta.type === 'v3' | 'v4'`. */
function txMetaV3Xdr(): string {
  const { TransactionMetaV3Arm } = StellarSdk.xdr as unknown as {
    TransactionMetaV3Arm: new (v3: unknown) => unknown;
  };
  const v3 = new StellarSdk.xdr.TransactionMetaV3({
    ext: StellarSdk.xdr.ExtensionPoint.v0(),
    txChangesBefore: [],
    operations: [],
    txChangesAfter: [],
    sorobanMeta: null,
  });
  return (new TransactionMetaV3Arm(v3 as never) as { toXDR: (enc: string) => string }).toXDR('base64');
}

/**
 * In-process Soroban JSON-RPC server.
 *
 * Implements exactly the subset `services/freighter.ts` exercises —
 * `getLedgerEntries` (account loads), `simulateTransaction`, `sendTransaction`,
 * `getTransaction` — with responses that pass the installed SDK's strict XDR
 * parsers, so the full sign-and-submit pipeline runs for real in tests.
 *
 * Every responded hash is derived from the envelope the page submitted, so
 * assertion helpers can correlate submissions without reaching into the SDK.
 */
export class MockSorobanRpc {
  private server: Server | null = null;
  private port = 0;
  private readonly submittedEnvelopes: string[] = [];

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Envelope XDRs received by sendTransaction, in submission order. */
  get envelopes(): string[] {
    return [...this.submittedEnvelopes];
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const handle = (body: JsonRpcBody): Record<string, unknown> => {
      switch (body.method) {
        case 'getLedgerEntries': {
          const keys = (body.params.keys as string[]) ?? [];
          const entries = keys
            .map((keyXdr) => {
              const key = StellarSdk.xdr.LedgerKey.fromXDR(keyXdr, 'base64');
              if (key.type !== 'account') {
                return null;
              }
              const address = StellarSdk.StrKey.encodeEd25519PublicKey(
                (key.account.accountId.ed25519 as { value: Uint8Array }).value,
              );
              return {
                key: keyXdr,
                xdr: accountEntryXdr(address),
                lastModifiedLedgerSeq: 1000,
              };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
          return { entries, latestLedger: 2000 };
        }

        case 'simulateTransaction':
          return {
            transactionData: emptySorobanDataXdr(),
            minResourceFee: '1200',
            results: [
              { auth: [], xdr: StellarSdk.xdr.ScVal.scvVoid().toXDR('base64') },
            ],
            events: [],
            latestLedger: 2000,
          };

        case 'sendTransaction': {
          const envelope = body.params.transaction as string;
          this.submittedEnvelopes.push(envelope);
          const hash = createHash('sha256')
            .update(Buffer.from(envelope, 'base64'))
            .digest('hex');
          return { status: 'PENDING', hash, latestLedger: 2001 };
        }

        case 'getTransaction': {
          const hash = body.params.hash as string;
          return {
            status: 'SUCCESS',
            ledger: 2002,
            createdAt: Math.floor(Date.now() / 1000),
            applicationOrder: 1,
            feeBump: false,
            envelopeXdr: this.submittedEnvelopes[0] ?? '',
            resultXdr: txResultXdr(),
            resultMetaXdr: txMetaV3Xdr(),
            txHash: hash,
            latestLedger: 2002,
            oldestLedger: 2000,
            latestLedgerCloseTime: 1,
            oldestLedgerCloseTime: 0,
          };
        }

        default:
          return { error: { code: -32601, message: `method not found: ${body.method}` } };
      }
    };

    this.server = createServer((req, res) => {
      // The app origin (localhost:3000) differs from this server's origin, so
      // the browser preflights every JSON-RPC request and enforces CORS.
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        let parsed: JsonRpcBody;
        try {
          parsed = JSON.parse(raw) as JsonRpcBody;
        } catch {
          parsed = { id: null, method: '', params: {} };
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id ?? null,
            result: handle(parsed),
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        this.port = typeof address === 'object' && address !== null ? address.port : 0;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Default token addresses served by the backend (backend/src/config.ts):
 * pledge signing resolves config.assetAddresses[assetCode] before any RPC
 * call, so the mock config must carry the same entries the real one does.
 */
export const MOCK_ASSET_ADDRESSES = {
  XLM: 'CDLZFC3SYJYDZT7K3SSTH3YCUY6AFMCO3Y6S3G7FEYZNVNREK7Y6DZSV',
  USDC: 'CA6WSTPZ7RRCUC6H37CQFODG763XG2HXP2G6F367VCOGGVDP32P77BBF',
} as const;

/** Default AppConfig fragment the UI consumes from /api/config. */
export function mockAppConfigSoroban(rpcUrl: string) {
  return {
    allowedAssets: ['USDC', 'XLM'],
    soroban: {
      enabled: true,
      contractId: MOCK_CONTRACT_ID,
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl,
    },
    sorobanRpcUrl: rpcUrl,
    contractId: MOCK_CONTRACT_ID,
    networkPassphrase: TESTNET_PASSPHRASE,
    contractAmountDecimals: 2,
    walletIntegrationReady: true,
    assetAddresses: { ...MOCK_ASSET_ADDRESSES },
  };
}
