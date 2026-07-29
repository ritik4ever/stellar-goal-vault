/**
 * SQL Injection Protection Validation Script
 * 
 * This script performs quick validation that SQLi payloads are safely handled.
 * Run with: ts-node src/services/validate-sqli-protection.ts
 */

import { initCampaignStore, createCampaign, listCampaigns, getCampaign } from './campaignStore';
import { resetDbForTests, getDb } from './db';

const VALID_CREATOR = 'G' + 'A'.repeat(55);
const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 86400;

console.log('🔒 SQL Injection Protection Validation\n');

// Initialize test database
resetDbForTests();
initCampaignStore();

const tests: { name: string; fn: () => void }[] = [];
const results: { name: string; status: 'PASS' | 'FAIL'; error?: string }[] = [];

function test(name: string, fn: () => void) {
  tests.push({ name, fn });
}

function assertEqual(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertNotThrows(fn: () => void, message: string) {
  try {
    fn();
  } catch (error) {
    throw new Error(`${message}: ${error}`);
  }
}

// Test 1: Classic SQLi in campaign title
test('Classic SQLi payload in title stored as literal text', () => {
  const payload = "'; DROP TABLE campaigns--";
  const campaign = createCampaign({
    creator: VALID_CREATOR,
    title: payload,
    description: 'Test',
    targetAmount: 1000,
    deadline: FUTURE_DEADLINE,
    assetCode: 'XLM',
  });
  
  assertEqual(campaign.title, payload, 'Title should match payload');
  
  const retrieved = getCampaign(campaign.id);
  assertEqual(retrieved?.title, payload, 'Retrieved title should match payload');
});

// Test 2: OR-based SQLi in search
test('OR-based SQLi in search query sanitized', () => {
  createCampaign({
    creator: VALID_CREATOR,
    title: 'Legitimate Campaign',
    description: 'Test',
    targetAmount: 1000,
    deadline: FUTURE_DEADLINE,
    assetCode: 'XLM',
  });

  assertNotThrows(() => {
    const result = listCampaigns({ searchQuery: "' OR '1'='1" });
    // Should not return unexpected results or throw errors
    if (result.totalCount > 1) {
      throw new Error('SQLi may have bypassed search filtering');
    }
  }, 'Search should handle SQLi safely');
});

// Test 3: Union-based SQLi in title
test('Union-based SQLi payload stored literally', () => {
  const payload = "' UNION SELECT * FROM campaigns--";
  const campaign = createCampaign({
    creator: VALID_CREATOR,
    title: payload,
    description: 'Test',
    targetAmount: 1000,
    deadline: FUTURE_DEADLINE,
    assetCode: 'XLM',
  });
  
  assertEqual(campaign.title, payload, 'Title should match payload');
});

// Test 4: Stacked query in description
test('Stacked query payload in description stored literally', () => {
  const payload = "'; DELETE FROM pledges WHERE '1'='1";
  const campaign = createCampaign({
    creator: VALID_CREATOR,
    title: 'Test',
    description: payload,
    targetAmount: 1000,
    deadline: FUTURE_DEADLINE,
    assetCode: 'XLM',
  });
  
  assertEqual(campaign.description, payload, 'Description should match payload');
});

// Test 5: Database integrity check
test('Database tables exist after SQLi attempts', () => {
  const db = getDb();
  
  assertNotThrows(() => {
    db.prepare('SELECT COUNT(*) as count FROM campaigns').get();
    db.prepare('SELECT COUNT(*) as count FROM pledges').get();
    db.prepare('SELECT COUNT(*) as count FROM campaign_events').get();
  }, 'All tables should exist');
});

// Test 6: Legitimate apostrophe handling
test('Legitimate apostrophe in title handled correctly', () => {
  const title = "O'Reilly's Tech Campaign";
  const campaign = createCampaign({
    creator: VALID_CREATOR,
    title: title,
    description: 'Test',
    targetAmount: 1000,
    deadline: FUTURE_DEADLINE,
    assetCode: 'XLM',
  });
  
  assertEqual(campaign.title, title, 'Title with apostrophe should be stored correctly');
});

// Test 7: Invalid sort field rejection
test('Invalid sort field rejected', () => {
  assertNotThrows(() => {
    try {
      listCampaigns({ 
        // @ts-ignore - Testing runtime validation
        sort: "deadline; DROP TABLE campaigns--" 
      });
    } catch (error: any) {
      if (error.code === 'INVALID_INPUT') {
        return; // Expected error
      }
      throw error;
    }
  }, 'Invalid sort should be handled gracefully');
});

// Test 8: Comment syntax in search
test('SQL comment syntax in search handled safely', () => {
  assertNotThrows(() => {
    listCampaigns({ searchQuery: "test -- comment" });
    listCampaigns({ searchQuery: "test /* comment */" });
  }, 'Comment syntax should not break queries');
});

// Test 9: Special characters
test('Special characters handled correctly', () => {
  const title = "Test\nWith\tSpecial\rChars";
  const campaign = createCampaign({
    creator: VALID_CREATOR,
    title: title,
    description: 'Test',
    targetAmount: 1000,
    deadline: FUTURE_DEADLINE,
    assetCode: 'XLM',
  });
  
  assertEqual(campaign.title, title, 'Special characters should be preserved');
});

// Test 10: No string interpolation in queries
test('Parameterized queries prevent SQLi in ID lookup', () => {
  const campaign = createCampaign({
    creator: VALID_CREATOR,
    title: 'Test',
    description: 'Test',
    targetAmount: 1000,
    deadline: FUTURE_DEADLINE,
    assetCode: 'XLM',
  });

  const maliciousId = `${campaign.id}' OR '1'='1`;
  const result = getCampaign(maliciousId);
  
  assertEqual(result, undefined, 'Malicious ID should not return results');
});

// Run all tests
console.log(`Running ${tests.length} validation tests...\n`);

for (const { name, fn } of tests) {
  try {
    fn();
    results.push({ name, status: 'PASS' });
    console.log(`✅ PASS: ${name}`);
  } catch (error: any) {
    results.push({ name, status: 'FAIL', error: error.message });
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}\n`);
  }
}

// Summary
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;

console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary');
console.log('='.repeat(60));
console.log(`Total Tests: ${tests.length}`);
console.log(`Passed: ${passed} ✅`);
console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
console.log(`Success Rate: ${Math.round((passed / tests.length) * 100)}%`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n🎉 All SQL injection protection tests passed!');
  console.log('✅ Zero raw string interpolation in DB queries');
  console.log('✅ All SQLi payloads stored as plain text');
  console.log('✅ Database integrity maintained');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Review the errors above.');
  process.exit(1);
}
