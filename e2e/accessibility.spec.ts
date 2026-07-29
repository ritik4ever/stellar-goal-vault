import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHtmlReport } from 'axe-html-reporter';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Accessibility Audit (WCAG 2.1 AA)', () => {
  test('should not have any automatically detectable accessibility issues on main pages', async ({ page }, testInfo) => {
    // Navigate to the main page
    await page.goto('/');
    
    // Wait for the main page to render fully
    await page.waitForSelector('.app-shell');
    await page.waitForTimeout(2000); // Give it a moment to stabilize animations

    // Run the axe-core scan for WCAG 2.1 AA
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Generate HTML report
    const reportDir = path.join(process.cwd(), 'playwright-report');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    createHtmlReport({
      results: accessibilityScanResults,
      options: {
        projectKey: 'Stellar Goal Vault',
        outputDir: reportDir,
        reportFileName: 'accessibility-report.html'
      }
    });

    // Attach the report to Playwright's test results
    await testInfo.attach('accessibility-report', {
      path: path.join(reportDir, 'accessibility-report.html'),
      contentType: 'text/html'
    });

    // Filter violations by critical and serious
    const severeViolations = accessibilityScanResults.violations.filter(
      violation => violation.impact === 'critical' || violation.impact === 'serious'
    );

    // Output the violations to the console for better visibility in CI logs
    if (severeViolations.length > 0) {
      console.error('Accessibility Violations Found:');
      severeViolations.forEach(violation => {
        console.error(`\n[${violation.impact}] ${violation.id}: ${violation.description}`);
        console.error(`Help: ${violation.helpUrl}`);
        violation.nodes.forEach(node => {
          console.error(`  - Element: ${node.html}`);
          console.error(`    Target: ${node.target.join(', ')}`);
        });
      });
    }

    // Fail the test if there are any critical or serious violations
    expect(severeViolations).toEqual([]);
  });
});
