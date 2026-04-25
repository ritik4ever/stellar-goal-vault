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
  readonly campaignsTable: Locator;

  constructor(page: Page) {
    this.page = page;
    this.creatorInput = page.locator('input[placeholder*="G... creator public key"]');
    this.titleInput = page.locator('input[placeholder="Stellar community design sprint"]');
    this.descriptionInput = page.locator('textarea[placeholder*="Describe what the campaign funds"]');
    this.targetAmountInput = page.locator('label:has-text("Target amount") >> input');
    this.deadlineHoursInput = page.locator('label:has-text("Deadline in hours") >> input');
    this.createButton = page.locator('button:has-text("Create campaign")');
    this.connectWalletButton = page.locator('button:has-text("Connect Freighter")');
    this.pledgeAmountInput = page.locator('label:has-text("Pledge amount") >> input');
    this.addPledgeButton = page.locator('button:has-text("Add pledge")');
    this.claimVaultButton = page.locator('button:has-text("Claim vault")');
    this.campaignsTable = page.locator('.campaigns-table');
  }

  async goto() {
    await this.page.goto('/');
  }

  async createCampaign(creator: string, title: string, description: string, target: string) {
    await this.creatorInput.fill(creator);
    await this.titleInput.fill(title);
    await this.descriptionInput.fill(description);
    await this.targetAmountInput.fill(target);
    await this.deadlineHoursInput.fill('24');
    await this.createButton.click();
    
    // Wait for the new campaign to appear in the table
    await expect(this.page.locator(`text=${title}`)).toBeVisible();
  }

  async selectCampaign(title: string) {
    await this.page.locator(`tr:has-text("${title}")`).click();
  }

  async connectWallet() {
    await this.connectWalletButton.click();
    await expect(this.page.locator('text=Connected wallet')).toBeVisible();
  }

  async pledge(amount: string) {
    await this.pledgeAmountInput.fill(amount);
    await this.addPledgeButton.click();
    await expect(this.page.locator('text=Pledge recorded in the local goal vault')).toBeVisible();
  }

  async claim() {
    await this.claimVaultButton.click();
    // Wait for claimed status
    await expect(this.page.locator('text=Campaign claimed successfully')).toBeVisible();
  }
}
