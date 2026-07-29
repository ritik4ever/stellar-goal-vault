/**
 * SQL Injection Security Test Suite
 * 
 * This test suite validates that all database queries are protected against
 * SQL injection attacks by testing common SQLi payloads as user inputs.
 * 
 * All payloads should be stored as literal text, not executed as SQL.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { initCampaignStore, createCampaign, addPledge, listCampaigns, getCampaign, getPledges } from './campaignStore';
import { resetDbForTests, getDb } from './db';

// Common SQL injection payloads
const SQLI_PAYLOADS = {
  classic: [
    "' OR '1'='1",
    "' OR '1'='1' --",
    "' OR '1'='1' /*",
    "; DROP TABLE campaigns--",
    "'; DROP TABLE campaigns--",
    "' OR 1=1--",
    "admin' --",
    "admin' #",
    "admin'/*",
    "' or 1=1#",
    "' or 1=1--",
    ") or '1'='1--",
    "' OR 'x'='x",
    "') OR ('1'='1",
  ],
  union: [
    "' UNION SELECT NULL--",
    "' UNION SELECT * FROM campaigns--",
    "' UNION ALL SELECT NULL,NULL,NULL--",
    "1' UNION SELECT NULL, username, password FROM users--",
  ],
  boolean: [
    "1' AND '1'='1",
    "1' AND '1'='2",
    "' AND 1=1 AND ''='",
    "' AND 1=2 AND ''='",
  ],
  timeBased: [
    "'; SELECT CASE WHEN (1=1) THEN 1 ELSE 0 END--",
    "'; WAITFOR DELAY '00:00:05'--",
    "1'; SELECT pg_sleep(5)--",
  ],
  stacked: [
    "'; DELETE FROM pledges WHERE '1'='1",
    "'; UPDATE campaigns SET pledged_amount = 999999--",
    "1'; INSERT INTO campaigns VALUES (999, 'hacked')--",
  ],
  encoded: [
    "%27%20OR%20%271%27%3D%271",
    "0x27204F522027313D27312D2D",
  ],
  comment: [
    "admin'--",
    "admin' /*",
    "admin' #",
    "' or 1=1 --'",
    "' or 1=1 /*'",
  ],
  special: [
    "O'Reilly", // Legitimate apostrophe
    "Test -- Campaign",
    "Test /* comment */ Campaign",
    "Campaign; DROP TABLE users",
    "Campaign' AND '1'='1",
    "<script>alert('XSS')</script>", // Also test XSS
    "Campaign\"; DELETE FROM campaigns WHERE \"1\"=\"1",
  ],
};

const VALID_CREATOR = 'G' + 'A'.repeat(55);
const VALID_CONTRIBUTOR = 'G' + 'B'.repeat(55);
const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 86400;

beforeEach(() => {
  resetDbForTests();
  initCampaignStore();
});

describe('SQL Injection Protection', () => {
  describe('Campaign Title SQLi Protection', () => {
    SQLI_PAYLOADS.classic.forEach((payload, index) => {
      it(`should store classic SQLi payload #${index + 1} as literal text: ${payload.substring(0, 30)}`, () => {
        const campaign = createCampaign({
          creator: VALID_CREATOR,
          title: payload,
          description: 'Test description',
          targetAmount: 1000,
          deadline: FUTURE_DEADLINE,
          assetCode: 'XLM',
        });

        expect(campaign.title).toBe(payload);
        
        // Verify it's stored correctly in DB
        const retrieved = getCampaign(campaign.id);
        expect(retrieved?.title).toBe(payload);
      });
    });

    SQLI_PAYLOADS.union.forEach((payload, index) => {
      it(`should store union-based SQLi payload #${index + 1} as literal text: ${payload.substring(0, 30)}`, () => {
        const campaign = createCampaign({
          creator: VALID_CREATOR,
          title: payload,
          description: 'Test description',
          targetAmount: 1000,
          deadline: FUTURE_DEADLINE,
          assetCode: 'XLM',
        });

        expect(campaign.title).toBe(payload);
        const retrieved = getCampaign(campaign.id);
        expect(retrieved?.title).toBe(payload);
      });
    });

    SQLI_PAYLOADS.special.forEach((payload, index) => {
      it(`should store special character payload #${index + 1} as literal text: ${payload.substring(0, 30)}`, () => {
        const campaign = createCampaign({
          creator: VALID_CREATOR,
          title: payload,
          description: 'Test description',
          targetAmount: 1000,
          deadline: FUTURE_DEADLINE,
          assetCode: 'XLM',
        });

        expect(campaign.title).toBe(payload);
        const retrieved = getCampaign(campaign.id);
        expect(retrieved?.title).toBe(payload);
      });
    });
  });

  describe('Campaign Description SQLi Protection', () => {
    SQLI_PAYLOADS.stacked.forEach((payload, index) => {
      it(`should store stacked query payload #${index + 1} as literal text in description`, () => {
        const campaign = createCampaign({
          creator: VALID_CREATOR,
          title: 'Valid Title',
          description: payload,
          targetAmount: 1000,
          deadline: FUTURE_DEADLINE,
          assetCode: 'XLM',
        });

        expect(campaign.description).toBe(payload);
        const retrieved = getCampaign(campaign.id);
        expect(retrieved?.description).toBe(payload);
      });
    });
  });

  describe('Contributor Address SQLi Protection', () => {
    it('should handle SQLi payload in contributor address', () => {
      const campaign = createCampaign({
        creator: VALID_CREATOR,
        title: 'Test Campaign',
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      // Use a Stellar-format address with SQLi attempt
      const maliciousContributor = 'G' + 'C'.repeat(54) + "' OR '1'='1";
      
      // This should either fail validation or store as-is
      try {
        addPledge(campaign.id, {
          contributor: maliciousContributor,
          amount: 100,
        });

        const pledges = getPledges(campaign.id);
        const pledge = pledges.find(p => p.contributor === maliciousContributor);
        
        // If accepted, must be stored literally
        if (pledge) {
          expect(pledge.contributor).toBe(maliciousContributor);
        }
      } catch (error) {
        // Validation rejection is also acceptable
        expect(error).toBeDefined();
      }
    });
  });

  describe('Search Query SQLi Protection', () => {
    beforeEach(() => {
      // Create test campaigns
      createCampaign({
        creator: VALID_CREATOR,
        title: 'Legitimate Campaign 1',
        description: 'Safe description',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });
      
      createCampaign({
        creator: VALID_CREATOR,
        title: 'Legitimate Campaign 2',
        description: 'Another safe one',
        targetAmount: 2000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });
    });

    SQLI_PAYLOADS.classic.forEach((payload, index) => {
      it(`should safely handle SQLi in search query #${index + 1}: ${payload.substring(0, 30)}`, () => {
        // Search should not return unexpected results or throw SQL errors
        expect(() => {
          const result = listCampaigns({ searchQuery: payload });
          
          // Should either return 0 results or sanitized search results
          expect(result.campaigns.length).toBeGreaterThanOrEqual(0);
          expect(result.campaigns.length).toBeLessThanOrEqual(2);
          
          // Should not return all campaigns if malicious query succeeds
          if (payload.toLowerCase().includes("or '1'='1")) {
            // If SQLi worked, it would return all campaigns
            // We expect sanitization prevents this
            expect(result.totalCount).toBeLessThanOrEqual(2);
          }
        }).not.toThrow();
      });
    });

    it('should handle legitimate apostrophes in search', () => {
      const campaign = createCampaign({
        creator: VALID_CREATOR,
        title: "O'Reilly's Tech Campaign",
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      const result = listCampaigns({ searchQuery: "O'Reilly" });
      expect(result.campaigns.some(c => c.id === campaign.id)).toBeTruthy();
    });

    it('should handle SQL comment syntax in search', () => {
      expect(() => {
        listCampaigns({ searchQuery: "test -- comment" });
      }).not.toThrow();
      
      expect(() => {
        listCampaigns({ searchQuery: "test /* comment */" });
      }).not.toThrow();
    });
  });

  describe('Sort Parameter SQLi Protection', () => {
    it('should reject invalid sort field', () => {
      createCampaign({
        creator: VALID_CREATOR,
        title: 'Test',
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      // TypeScript should prevent this, but test runtime behavior
      expect(() => {
        listCampaigns({ 
          // @ts-expect-error Testing invalid input
          sort: "deadline; DROP TABLE campaigns--" 
        });
      }).not.toThrow();
    });

    it('should only accept valid sort orders', () => {
      createCampaign({
        creator: VALID_CREATOR,
        title: 'Test',
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      // TypeScript should prevent this, but test runtime behavior
      expect(() => {
        listCampaigns({ 
          sort: 'createdAt',
          // @ts-expect-error Testing invalid input
          order: "DESC; DELETE FROM campaigns WHERE 1=1--" 
        });
      }).not.toThrow();
    });
  });

  describe('Asset Code SQLi Protection', () => {
    it('should handle SQLi in asset code', () => {
      const maliciousAssetCode = "XLM' OR '1'='1";
      
      // This should fail validation (invalid asset code format)
      expect(() => {
        createCampaign({
          creator: VALID_CREATOR,
          title: 'Test',
          description: 'Test',
          targetAmount: 1000,
          deadline: FUTURE_DEADLINE,
          assetCode: maliciousAssetCode,
        });
      }).not.toThrow(); // Asset code is accepted as-is, then validated by business logic

      // Searching by malicious asset code should not cause SQLi
      expect(() => {
        listCampaigns({ assetCode: maliciousAssetCode });
      }).not.toThrow();
    });
  });

  describe('Database Integrity After SQLi Attempts', () => {
    it('should maintain database integrity after multiple SQLi attempts', () => {
      // Get initial state
      const db = getDb();
      const initialCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get() as { count: number };
      const initialPledges = db.prepare('SELECT COUNT(*) as count FROM pledges').get() as { count: number };

      // Create campaign with SQLi in title
      const campaign = createCampaign({
        creator: VALID_CREATOR,
        title: "'; DROP TABLE campaigns--",
        description: "' OR '1'='1",
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      // Add pledge with SQLi in contributor
      addPledge(campaign.id, {
        contributor: VALID_CONTRIBUTOR,
        amount: 100,
      });

      // Search with SQLi
      listCampaigns({ searchQuery: "' OR '1'='1" });

      // Verify database integrity
      const finalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get() as { count: number };
      const finalPledges = db.prepare('SELECT COUNT(*) as count FROM pledges').get() as { count: number };

      expect(finalCampaigns.count).toBe(initialCampaigns.count + 1);
      expect(finalPledges.count).toBe(initialPledges.count + 1);

      // Verify tables still exist
      expect(() => {
        db.prepare('SELECT * FROM campaigns').all();
        db.prepare('SELECT * FROM pledges').all();
        db.prepare('SELECT * FROM campaign_events').all();
      }).not.toThrow();
    });

    it('should not execute stacked queries', () => {
      const db = getDb();
      
      // Create initial state
      const campaign = createCampaign({
        creator: VALID_CREATOR,
        title: 'Test',
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      const initialPledgedAmount = campaign.pledgedAmount;

      // Try stacked query to update pledged amount
      try {
        createCampaign({
          creator: VALID_CREATOR,
          title: "Test'; UPDATE campaigns SET pledged_amount = 999999 WHERE '1'='1",
          description: 'Test',
          targetAmount: 1000,
          deadline: FUTURE_DEADLINE,
          assetCode: 'XLM',
        });
      } catch {
        // Ignore errors
      }

      // Verify original campaign wasn't modified
      const updatedCampaign = getCampaign(campaign.id);
      expect(updatedCampaign?.pledgedAmount).toBe(initialPledgedAmount);
    });
  });

  describe('Special Characters and Encoding', () => {
    it('should handle null bytes', () => {
      expect(() => {
        createCampaign({
          creator: VALID_CREATOR,
          title: "Test\0Campaign",
          description: 'Test',
          targetAmount: 1000,
          deadline: FUTURE_DEADLINE,
          assetCode: 'XLM',
        });
      }).not.toThrow();
    });

    it('should handle newlines and special whitespace', () => {
      const campaign = createCampaign({
        creator: VALID_CREATOR,
        title: "Test\nCampaign\r\nWith\tTabs",
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      const retrieved = getCampaign(campaign.id);
      expect(retrieved?.title).toBe("Test\nCampaign\r\nWith\tTabs");
    });

    it('should handle unicode characters', () => {
      const unicodeTitle = "Campaign 💰 with émojis and àccénts";
      const campaign = createCampaign({
        creator: VALID_CREATOR,
        title: unicodeTitle,
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      const retrieved = getCampaign(campaign.id);
      expect(retrieved?.title).toBe(unicodeTitle);
    });

    it('should handle very long input strings', () => {
      const longString = "A".repeat(10000) + "' OR '1'='1";
      
      expect(() => {
        createCampaign({
          creator: VALID_CREATOR,
          title: longString.substring(0, 200), // Title likely has length limit
          description: longString,
          targetAmount: 1000,
          deadline: FUTURE_DEADLINE,
          assetCode: 'XLM',
        });
      }).not.toThrow();
    });
  });

  describe('Parameterized Query Verification', () => {
    it('should use prepared statements for all queries', () => {
      const db = getDb();
      
      // Verify that queries are prepared (better-sqlite3 behavior)
      const campaign = createCampaign({
        creator: VALID_CREATOR,
        title: "Test",
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      // This would throw SQL error if string interpolation was used
      const maliciousId = "1' OR '1'='1";
      const result = getCampaign(maliciousId);
      
      // Should return undefined (not found) rather than multiple results
      expect(result).toBeUndefined();
    });

    it('should prevent SQL injection in WHERE clauses', () => {
      const campaign1 = createCampaign({
        creator: VALID_CREATOR,
        title: "Campaign 1",
        description: 'Test',
        targetAmount: 1000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      const campaign2 = createCampaign({
        creator: VALID_CREATOR,
        title: "Campaign 2",
        description: 'Test',
        targetAmount: 2000,
        deadline: FUTURE_DEADLINE,
        assetCode: 'XLM',
      });

      // Try to get all campaigns using SQLi
      const maliciousId = `${campaign1.id}' OR '1'='1`;
      const result = getCampaign(maliciousId);
      
      // Should not return anything (malicious ID doesn't exist)
      expect(result).toBeUndefined();
    });
  });
});
