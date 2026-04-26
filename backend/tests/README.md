# Integration Test Suite: Campaign Lifecycle State Transitions

This directory contains comprehensive end-to-end integration tests for the Stellar Goal Vault API, covering the complete campaign lifecycle: Create → Pledge → Claim/Refund.

## Overview

The integration test suite provides:

- **Isolated Test Database**: Each test worker uses a temporary SQLite database (`/tmp/stellar-goal-vault-integration-*.db`) to prevent test pollution and cross-contamination
- **Parallel Execution**: Tests run in parallel using 4 worker threads by default
- **State Machine Verification**: Complete validation of campaign state transitions
- **Edge Case Coverage**: Double claims, invalid refunds, unauthorized actions, etc.
- **Event History Tracking**: Full audit trail of all campaign events
- **Concurrent Request Handling**: Stress tests for data consistency under load

## Requirements

- Node.js 18+
- npm or yarn
- Vitest (installed via `npm install`)

## Running Tests

### Run All Tests

```bash
npm test
```

This will:
1. Discover all `*.test.ts` and `*.integration.ts` files
2. Start an isolated Express server for each test worker
3. Execute tests in parallel (up to 4 concurrent threads)
4. Use isolated temporary databases to prevent cross-test pollution
5. Clean up after tests complete

### Run Unit Tests Only

```bash
npm test -- src/**/*.test.ts
```

### Run Integration Tests Only

```bash
npm test -- tests/**/*.integration.ts
```

### Run Specific Test Suite

```bash
npm test -- tests/integration_test.ts
```

### Run Tests in Watch Mode

```bash
npm test -- --watch
```

Tests will re-run whenever files change.

### Run Tests with Coverage

```bash
npm test -- --coverage
```

Generates coverage reports in HTML format (view in `coverage/index.html`).

### Debug Tests

```bash
npm test -- --inspect --inspect-brk
```

Then open `chrome://inspect` in Chrome DevTools.

## Test Structure

### Test File Location

```
backend/
├── tests/
│   ├── integration_test.ts     # Main integration test suite
│   ├── utils.ts                # Shared test utilities and helpers
│   └── README.md               # This file
├── src/
│   ├── index.ts                # API server
│   ├── index.test.ts           # Unit tests
│   └── services/
│       └── campaignStore.test.ts  # Unit tests
```

### Test Discovery

Vitest automatically discovers test files matching these patterns:
- `src/**/*.test.ts` - Unit tests
- `tests/**/*.test.ts` - Integration tests  
- `tests/**/*.integration.ts` - Integration tests

## Test Scenarios

### Happy Path
- **Campaign Lifecycle**: Create campaign → Multiple pledges → Reach target → Claim funds → Verify all events recorded

### Edge Cases
- **Double Claim**: Prevent claiming the same campaign twice
- **Claim Without Funding**: Prevent claim before reaching target amount
- **Claim Before Deadline**: Prevent early claims
- **Refund After Claim**: Prevent refunds from claimed campaigns
- **Failed Campaign Refunds**: Allow refunds when campaign fails to reach target
- **Non-existent Contributor Refund**: Reject refunds for contributors who didn't pledge
- **Double Refund**: Prevent refunding the same contributor twice

### Authorization & Validation
- **Unauthorized Claim**: Prevent non-creator from claiming
- **Field Validation**: Ensure all required fields are validated
- **Pledge Constraints**: Validate pledge amounts and campaign state
- **Non-existent Campaigns**: Reject all operations on non-existent campaigns

### State Consistency
- **State Transitions**: Verify correct state changes across operations
- **Event Ordering**: Ensure events are recorded in correct chronological order
- **Independent Campaigns**: Verify multiple campaigns don't interfere with each other

## Test Database Isolation

Each test worker gets a dedicated temporary database:

```
/tmp/stellar-goal-vault-integration-{PID}-{TIMESTAMP}.db
```

**Key Features:**
- Databases are automatically created before tests run
- Databases are automatically cleaned up after tests complete
- No shared state between tests or test workers
- Parallel tests use different process IDs to ensure unique database paths
- WAL (Write-Ahead Logging) mode enabled for reliability
- Foreign key constraints enabled

### Why Isolation Matters

Perfect isolation ensures:
- ✅ No test pollution - one test's data doesn't affect another
- ✅ Parallel execution - tests can safely run simultaneously
- ✅ CI/CD friendly - consistent results across multiple runs
- ✅ Fast cleanup - simple file deletion after tests
- ✅ No production contamination - uses temporary files only

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: cd backend && npm install
      
      - name: Run integration tests
        run: cd backend && npm test
        env:
          NODE_ENV: test
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        if: always()
```

### Performance Tips for CI/CD

1. **Parallel Workers**: Tests run on 4 threads by default
2. **Timeout**: Default timeout is 30 seconds per test
3. **No Persistence**: Temporary databases are cleaned up immediately
4. **No Side Effects**: No locks or shared database files
5. **Fast Cleanup**: Uses file system for test databases (not slow network calls)

## Test Utilities

### Shared Helpers (`tests/utils.ts`)

```typescript
// Mock data
MOCK_CREATORS.alice
MOCK_CONTRIBUTORS.dave
MOCK_ASSETS.USDC

// Time helpers
nowInSeconds()
generateTxHash()
sleep(ms)
roundAmount(value)

// API helpers
createCampaign(apiClient, overrides)
addPledge(apiClient, campaignId, contributor, amount)
claimCampaign(apiClient, campaignId, creator)
refundContributor(apiClient, campaignId, contributor)
getCampaign(apiClient, campaignId)
getCampaignHistory(apiClient, campaignId)

// Assertion helpers
assertCampaignState(campaign, expectedState)
assertHistoryContains(history, expectedEvents)
assertError(response, expectedCode)
assertSuccess(response)
```

## Understanding the State Machine

### Campaign States

```
open (default)
  ├─→ funded (when pledged >= target AND deadline not reached)
  └─→ failed (when deadline reached AND pledged < target)

funded
  └─→ claimed (when creator claims AND deadline reached)

failed
  └─→ (no transition, contributors can refund)

claimed
  └─→ (terminal state, no further actions)
```

### State Transitions in API

| State | Can Pledge | Can Claim | Can Refund |
|-------|-----------|----------|-----------|
| open | ✅ | ❌ | ❌ |
| funded | ❌ | ✅ | ❌ |
| failed | ❌ | ❌ | ✅ |
| claimed | ❌ | ❌ | ❌ |

## Troubleshooting

### Tests Timeout

```bash
npm test -- --testTimeout 60000
```

Increase timeout to 60 seconds if tests need more time.

### Test Database Not Cleaned Up

```bash
rm /tmp/stellar-goal-vault-integration-*.db
```

Manually clean temporary databases.

### Port Already in Use

The test server uses a random available port (`PORT=0`), so port conflicts are unlikely. If they occur, check for lingering server processes:

```bash
lsof -i :3000  # Check if port 3000 is in use
```

### Memory Issues with Parallel Tests

Reduce thread count:

```bash
npm test -- --maxThreads 2
```

### Verbose Output

```bash
npm test -- --reporter=verbose
```

## Best Practices

1. **Use Test Utilities**: Import helpers from `tests/utils.ts` for consistency
2. **Create Separate Campaigns**: Don't share campaigns between tests (they use separate databases)
3. **Verify Events**: Always check event history for full audit trail
4. **Handle Errors**: Test both success and error paths
5. **Clean State**: Each test should start with a clean database
6. **Use Descriptive Names**: Test names should clearly describe what's being tested

## Performance Metrics

On a typical machine:
- Total test suite: **< 10 seconds**
- Per-test average: **100-500ms**
- Startup/teardown: **< 1 second per worker**
- Database operations: **< 50ms per operation**

## Debugging

### Print Test Details

```typescript
it("test name", async () => {
  console.log("Campaign:", campaign);
  console.log("History:", history);
});
```

Run with:
```bash
npm test -- --reporter=verbose 2>&1 | grep -A 10 "test name"
```

### Inspect Database

The test database files are temporary, but you can add debugging code to inspect them:

```typescript
const sqlite3 = require("better-sqlite3");
const db = sqlite3(TEST_DB_PATH);
console.log(db.prepare("SELECT * FROM campaigns").all());
```

## Contributing

When adding new tests:

1. Add test to `tests/integration_test.ts` or create new file
2. Use utilities from `tests/utils.ts`
3. Ensure tests are idempotent (can run multiple times)
4. No external dependencies
5. Clean up after tests (Vitest handles database cleanup)

## Related Documentation

- [Campaign Lifecycle Documentation](../CAMPAIGN_LIFECYCLE_IMPLEMENTATION.md)
- [Event Metadata Documentation](../EVENT_METADATA_DOCUMENTATION.md)
- [Main README](../README.md)
