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
    this.descriptionInput = page.locator(
      'textarea[placeholder*="Describe what the campaign funds"]',
    );
    this.targetAmountInput = page.locator('label:has-text("Target amount") >> input');
    this.deadlineHoursInput = page.locator('label:has-text("Deadline in hours") >> input');
    this.createButton = page.locator('button:has-text("Create campaign")');
    this.connectWalletButton = page.locator('.wallet-widget button:has-text("Connect Wallet")');
    this.pledgeAmountInput = page.locator('#pledge-amount');
    // Upstream renamed the buttons and gave the form a stable aria-label.
    this.addPledgeButton = page.locator('form[aria-label="Pledge form"] button[type="submit"]');
    this.claimVaultButton = page.locator('button:has-text("Claim funds")');
    this.campaignsTable = page.locator('.campaigns-table');
  }

  async goto() {
    await this.page.goto('/');
  }

  async createCampaign(
    creator: string,
    title: string,
    description: string,
    target: string,
    deadlineHours: string = '72',
  ) {
    // The create form is a 4-step wizard: Basics → Funding → Rewards → Review.
    await this.creatorInput.fill(creator);
    await this.titleInput.fill(title);
    await this.descriptionInput.fill(description);
    await this.page
      .getByRole('region', { name: 'Create Campaign' })
      .getByRole('combobox')
      .selectOption('Community');
    await this.page.locator('.wizard-nav button:has-text("Next")').click();

    await this.targetAmountInput.fill(target);
    await this.deadlineHoursInput.fill(deadlineHours);
    await this.page.locator('.wizard-nav button:has-text("Next")').click();

    // Rewards step is optional.
    await this.page.locator('.wizard-nav button:has-text("Next")').click();

    // Review step submits. The wizard unmounts as soon as creation succeeds,
    // so a click that lands right at submission can be retried against a
    // vanished button; resolve on whichever happens first.
    await Promise.race([
      this.createButton.click(),
      this.page.locator(`text=${title}`).first().waitFor(),
    ]);

    // Wait for the new campaign to appear in the table
    await expect(this.page.locator(`text=${title}`).first()).toBeVisible();
  }

  async selectCampaign(title: string) {
    await this.page.locator(`tr:has-text("${title}")`).click();
  }

  /**
   * Opens a campaign's detail panel via its deep link. Row clicks race with
   * the window-virtualized board (rows detach mid-click under list churn), so
   * deep linking through /campaigns/:id is the deterministic path.
   */
  async selectCampaignByTitle(title: string) {
    const response = await this.page.request.get(
      `/api/campaigns?search=${encodeURIComponent(title)}`,
    );
    const body = (await response.json()) as { data: Array<{ id: string; title: string }> };
    const found = body.data.find((entry) => entry.title === title);
    if (!found) {
      throw new Error(`campaign "${title}" not found via API`);
    }
    await this.page.goto(`/campaigns/${found.id}`);
    await expect(this.page.locator('.detail-panel h2')).toHaveText(title);
  }

  /**
   * Opens the wallet picker from the header widget and selects Freighter.
   * The current UI always routes through WalletPickerModal; "connected" is
   * signalled by the header pill rendering the truncated address.
   */
  async connectWallet(expectedAddress?: string) {
    await this.connectWalletButton.click();
    await expect(this.page.locator('.wallet-picker-modal')).toBeVisible();
    await this.page.locator('.wallet-option:has-text("Freighter")').click();
    await expect(this.page.locator('.wallet-widget--connected')).toBeVisible();
    if (expectedAddress) {
      // The address span embeds an sr-only "Wallet address: " label, which
      // counts toward textContent — assert containment, not exact equality.
      await expect(this.page.locator('.wallet-widget__address')).toContainText(
        `${expectedAddress.slice(0, 4)}…${expectedAddress.slice(-4)}`,
      );
    }
  }

  async pledge(amount: string) {
    await this.pledgeAmountInput.fill(amount);
    await this.addPledgeButton.click();
    // The detail panel flips into a pending state while the transaction is
    // previewed, simulated, and submitted; success is asserted by specs via
    // the toast or remaining-amount reads.
  }

  async claim() {
    // The countdown ticking beside the button keeps the DOM subtly unstable;
    // waiting for enablement first avoids click retries racing re-renders.
    await expect(this.claimVaultButton).toBeEnabled({ timeout: 30_000 });
    await this.claimVaultButton.click({ force: true });
    // Claim waits on the preview modal; confirming is spec-specific.
  }
}
