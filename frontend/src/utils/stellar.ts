const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

/**
 * Returns a Stellar Expert deep-link for a confirmed transaction hash.
 * Uses testnet explorer for the testnet passphrase, mainnet otherwise.
 */
export function stellarExpertTxUrl(
  txHash: string,
  networkPassphrase: string | undefined,
): string {
  const network =
    networkPassphrase === MAINNET_PASSPHRASE ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}
