# Event Metadata Support for Soroban Sync

## Overview

The event system now supports blockchain metadata fields to prepare for future Soroban synchronization. This allows events to store transaction hashes, ledger information, and other blockchain-specific data while maintaining backward compatibility with existing local event flows.

## Blockchain Metadata Fields

### BlockchainMetadata Interface

```typescript
interface BlockchainMetadata {
  txHash?: string;           // Transaction hash from Soroban
  ledgerNumber?: number;     // Ledger number where the event occurred
  ledgerCloseTime?: number;  // Timestamp when the ledger was closed
  eventIndex?: number;       // Index of the event within the ledger
  contractId?: string;       // Smart contract ID that emitted the event
  source?: 'local' | 'soroban'; // Source of the event
}
```

### Field Descriptions

- **txHash**: The unique transaction hash from the Stellar/Soroban network. Used for deduplication and linking events to on-chain transactions.
- **ledgerNumber**: The ledger sequence number where the transaction was included. Useful for ordering and querying events by blockchain time.
- **ledgerCloseTime**: Unix timestamp when the ledger was closed. Provides precise blockchain timing.
- **eventIndex**: The position of this event within the ledger. Combined with ledgerNumber, provides unique event identification.
- **contractId**: The Soroban smart contract that emitted this event. Helps filter events by contract.
- **source**: Indicates whether the event originated locally ('local') or from blockchain sync ('soroban').

## Database Schema Changes

The `campaign_events` table now includes a `blockchain_metadata` column:

```sql
ALTER TABLE campaign_events ADD COLUMN blockchain_metadata TEXT;

-- Indexes for efficient querying
CREATE INDEX idx_campaign_events_tx_hash ON campaign_events(json_extract(blockchain_metadata, '$.txHash'));
CREATE INDEX idx_campaign_events_ledger ON campaign_events(json_extract(blockchain_metadata, '$.ledgerNumber'));
```

## API Response Changes

Event objects in API responses now include the optional `blockchainMetadata` field:

```json
{
  "id": 123,
  "campaignId": "1",
  "eventType": "pledged",
  "timestamp": 1640995200,
  "actor": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "amount": 100.0,
  "metadata": {
    "newTotalPledged": 500.0
  },
  "blockchainMetadata": {
    "txHash": "abc123...",
    "ledgerNumber": 12345,
    "ledgerCloseTime": 1640995200,
    "eventIndex": 2,
    "contractId": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "source": "soroban"
  }
}
```

## Event Sources

### Local Events
Events created by local API operations (create campaign, add pledge, etc.) are marked with `source: 'local'` and contain no blockchain-specific fields until the operations are synchronized to the blockchain.

### Soroban Events
Events synchronized from the Soroban network contain full blockchain metadata including transaction hashes, ledger information, and contract details.

## Backward Compatibility

- Existing events without blockchain metadata continue to work normally
- The `blockchainMetadata` field is optional in all interfaces
- Local event flows remain unchanged
- API responses include the new field only when metadata is available

## New Query Functions

Additional helper functions are available for querying events by blockchain metadata:

```typescript
// Get event by transaction hash
getEventByTxHash(txHash: string): CampaignEvent | undefined

// Get all events from a specific ledger
getEventsByLedger(ledgerNumber: number): CampaignEvent[]

// Get events by source (local vs soroban)
getEventsBySource(source: 'local' | 'soroban'): CampaignEvent[]
```

## Event Deduplication

The event indexer now uses improved deduplication logic:

1. **Primary**: Transaction hash (if available)
2. **Fallback**: Ledger number + event index combination

This prevents duplicate events when synchronizing from the blockchain while allowing local events to coexist.

## Migration Notes

- The database migration automatically adds the new column to existing tables
- Existing events will have `blockchain_metadata` as `NULL`
- No data migration is required for existing events
- The system gracefully handles both old and new event formats

## Future Enhancements

This metadata structure prepares the system for:

- Real-time blockchain event synchronization
- Cross-chain event correlation
- Advanced event filtering and querying
- Blockchain transaction verification
- Event replay and audit capabilities