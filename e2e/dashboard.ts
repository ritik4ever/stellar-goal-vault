import { Page, Locator, expect } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly creatorInput: Locator;
  readonly titleInput: Locator;
  readonly descriptionInput: Locator;
  readonly targetAmountInput: Locator;
  readonly deadlineHoursInput: Locator;
  readonly createButton: Locator;
  readonly connectWalletButton: Locator;
  readonly pledgeAmountInput: Locator;
  readonly addPledgeButton: Locator;
  readonly claimVaultButton: Locator;
  readonly refundButton: Locator;
  readonly campaignsTable: Locator;

  constructor(page: Page) {
    this.page = page;
    this.creatorInput = page.locator('input[placeholder="G... creator public key"]');
    this.titleInput = page.locator('input[placeholder="Stellar community design sprint"]');
    this.descriptionInput = page.locator(
      'textarea[placeholder="Describe what the campaign funds, who benefits, and the delivery plan."]',
    );
    this.targetAmountInput = page.locator('label:has-text("Target amount (cumulative sum of units)") >> input');
    this.deadlineHoursInput = page.locator('label:has-text("Deadline in hours") >> input');
    this.createButton = page.locator('button:has-text("Create campaign")');
    this.connectWalletButton = page.locator('button:has-text("Connect Freighter")');
    this.pledgeAmountInput = page.locator('label:has-text("Pledge amount") >> input');
    this.addPledgeButton = page.locator('button:has-text("Add pledge")');
    this.claimVaultButton = page.locator('button:has-text("Claim vault")');
    this.refundButton = page.locator('button:has-text("Refund")');
    this.campaignsTable = page.locator('.campaigns-table');
  }

  async goto() {
    await this.page.goto('/', { waitUntil: 'networkidle' });
  }

  async createCampaign(creator: string, title: string, description: string, target: string, deadlineHours: string = '24') {
    // Wait for the creator input to be visible
    await this.creatorInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.creatorInput.fill(creator);
    await this.titleInput.fill(title);
    await this.descriptionInput.fill(description);
    await this.targetAmountInput.fill(target);
    await this.deadlineHoursInput.fill(deadlineHours);
    await this.createButton.click();

    // Wait for the new campaign to appear in the table
    await expect(this.page.locator(`text=${title}`)).toBeVisible({ timeout: 10000 });
  }

  async selectCampaign(title: string) {
    await expect(this.page.locator(`tr:has-text("${title}")`)).toBeVisible({ timeout: 10000 });
    await this.page.locator(`tr:has-text("${title}")`).click();
  }

  async connectWallet() {
    // Try to find the connect button - use class selector which is more reliable
    const connectButton = this.page.locator('button.wallet-widget__btn').or(
      this.page.locator('button:has-text("Connect")')
    );
    await connectButton.first().waitFor({ state: 'visible', timeout: 10000 });
    await connectButton.first().click();
    await expect(this.page.locator('text=Connected wallet')).toBeVisible({ timeout: 10000 });
  }

  async pledge(amount: string) {
    await this.pledgeAmountInput.fill(amount);
    await this.addPledgeButton.click();
    await expect(this.page.locator('text=Pledge recorded')).toBeVisible();
  }

  async claim() {
    await this.claimVaultButton.click();
    await expect(this.page.locator('text=Campaign claimed successfully')).toBeVisible();
  }

  async refund() {
    await this.refundButton.click();
    await expect(this.page.locator('text=Refund processed successfully')).toBeVisible();
  }
}