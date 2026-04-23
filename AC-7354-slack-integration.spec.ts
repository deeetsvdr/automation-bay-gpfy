import { expect, Page } from '@playwright/test';
import { test } from '@shared/fixtures/global-fixtures';
import { loginByUI } from '@shared/helpers/gui/loginHelper';

/**
 * AC-7354 Slack Integration coverage.
 *
 * Runbook:
 *  - This suite requires the target tenant to ALREADY be connected to a Slack workspace.
 *    Slack OAuth is consent-based and cannot be completed by an automated agent without
 *    a logged-in Slack user; see the describe("beforeEach") skip-guard below.
 *  - The "Disconnect → reconnect" describe leaves the tenant disconnected. Gate it behind
 *    SLACK_TEST_DISCONNECT=true so CI never flips that switch; run it locally when
 *    validating AC-7354 UI, then reconnect Slack manually.
 *  - Environment assumes storageState is a Gappify admin. Describe 5 logs out and signs
 *    in as a non-admin (TRD) user to assert access control.
 */

const env = process.env.ENV || 'qa';

const getLoginUrl = () => {
  if (env === 'prod') return 'https://login.gappify.com';
  if (env === 'uat') return 'https://uat.gappify.com';
  return `https://login.${env}.gappifyinc.com`;
};

const TRD_EMAIL = 'honeycombSaniAdmin';
const TRD_PASSWORD = 'honeycombSaniAdmin2026';

class SlackNotificationsPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/settings/integrations/slack', { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(1000);
  }

  workspacesSectionHeading() {
    return this.page
      .getByRole('heading', { name: /^(workspaces|connected slack workspace)$/i })
      .first();
  }

  oldWorkspacesDescription() {
    // Pre-AC-7354 copy that should disappear once the ticket ships.
    return this.page.getByText(
      /set one as active for test notifications and channels & users/i
    );
  }

  newWorkspacesDescription() {
    return this.page.getByText(/^connected slack workspace\.?$/i).first();
  }

  memberDirectoryCountSummary() {
    // e.g. "6 members in directory · 6 with email"
    return this.page.getByText(/\d+\s+members?\s+in\s+directory/i).first();
  }

  memberDirectorySnapshotBanner() {
    return this.page.getByText(
      /this is a snapshot of your slack workspace.*sync member directory.*refresh the list/is
    );
  }

  workspaceRows() {
    // Each connected workspace renders as an ant-collapse panel inside the Workspaces section.
    return this.page.locator('.ant-collapse-item');
  }

  workspaceNameLabel() {
    // Active workspace label appears once per connected workspace.
    return this.page.locator('.ant-collapse-header');
  }

  addAnotherWorkspaceButton() {
    return this.page.getByRole('button', { name: /add another workspace/i });
  }

  manageButton() {
    return this.page.getByRole('button', { name: /^manage$/i });
  }

  disconnectButton() {
    return this.page.getByRole('button', { name: /^disconnect$/i });
  }

  connectButton() {
    return this.page.getByRole('button', { name: /connect your slack workspace/i });
  }

  viewMemberDirectoryButton() {
    return this.page.getByRole('button', { name: /view member directory/i });
  }

  syncMemberDirectoryButton() {
    return this.page.getByRole('button', { name: /sync member directory/i });
  }

  async isConnected() {
    // Connected iff the prominent "Connect your Slack workspace" CTA is NOT on the page.
    const connectVisible = await this.connectButton()
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    return !connectVisible;
  }

  async debugSnapshot(): Promise<string> {
    const url = this.page.url();
    const heading =
      (await this.workspacesSectionHeading().textContent().catch(() => '')) || '(no heading)';
    const bodyText = (await this.page.locator('body').innerText().catch(() => '')).slice(0, 400);
    return `url=${url} | heading="${heading.trim()}" | body="${bodyText.replace(/\s+/g, ' ').trim()}"`;
  }

  async connectedWorkspaceName(): Promise<string | null> {
    const header = this.workspaceNameLabel().first();
    // Wait for the workspace collapse to render — the Test notification describe often reaches
    // this helper before the Workspaces section has finished hydrating.
    await header.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const count = await header.count().catch(() => 0);
    if (count === 0) return null;
    const text = (await header.textContent({ timeout: 5000 }).catch(() => '')) || '';
    // Prefer a kebab/dash-cased slug like "gpfy-development" — avoids picking up the team ID (e.g. T0AKM3YS24F).
    const kebab = text.match(/([a-z][a-z0-9]*-[a-z0-9][a-z0-9-]+)/i);
    if (kebab) return kebab[1];
    const word = text.match(/([a-z][a-z0-9_-]{2,})/i);
    return word ? word[1] : text.trim() || null;
  }

  deliveryRadio(option: 'email' | 'slack' | 'both') {
    const name =
      option === 'email'
        ? /email only/i
        : option === 'slack'
        ? /slack only/i
        : /email\s*\+\s*slack/i;
    return this.page.getByRole('radio', { name });
  }

  async currentDelivery(): Promise<'email' | 'slack' | 'both' | null> {
    for (const opt of ['email', 'slack', 'both'] as const) {
      if (await this.deliveryRadio(opt).isChecked().catch(() => false)) return opt;
    }
    return null;
  }

  saveButton() {
    return this.page.getByRole('button', { name: /^save$/i });
  }

  unsavedDeliveryBanner() {
    return this.page.getByText(/unsaved.*delivery|you have unsaved/i).first();
  }

  deliveryInfoBanner() {
    return this.page.locator('.ant-alert-info, [role="status"]').filter({ hasText: /using/i });
  }

  testNotificationCallout() {
    return this.page.getByText(/test notifications use your connected workspace/i);
  }

  recipientDropdown() {
    // Ant Design Select doesn't expose the placeholder on a native input; filter by visible placeholder text.
    return this.page
      .locator('.ant-select')
      .filter({ hasText: /search people to dm for this test/i })
      .first();
  }

  sendTestNotificationButton() {
    return this.page.getByRole('button', { name: /send test notification/i });
  }

  async openMemberDirectoryModal() {
    await this.viewMemberDirectoryButton().first().click();
    const modal = this.page.locator('.ant-drawer-content, .ant-modal-content').last();
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal.getByText(/member directory/i).first()).toBeVisible();
    return modal;
  }

  async closeMemberDirectoryModal(modal: ReturnType<Page['locator']>) {
    const closeButton = modal.getByRole('button', { name: /close/i }).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
  }

  async memberDirectoryEmailsFromModal(): Promise<string[]> {
    const modal = await this.openMemberDirectoryModal();
    const rows = modal.locator('tr, [role="row"]');
    await expect.poll(async () => rows.count(), { timeout: 10000 }).toBeGreaterThan(0);

    const texts = await rows.allInnerTexts();
    const emails = texts
      .flatMap((t) => t.split(/\s+/))
      .map((t) => t.trim().toLowerCase())
      .filter((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));

    await this.closeMemberDirectoryModal(modal);
    return Array.from(new Set(emails));
  }

  async memberCountFromModal(): Promise<number | null> {
    const modal = await this.openMemberDirectoryModal();
    const footerText = (await modal.getByText(/\d+\s+members?/i).first().textContent()) || '';
    await this.closeMemberDirectoryModal(modal);
    const match = footerText.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  async memberCountFromWorkspaceCard(): Promise<number | null> {
    const text = (await this.memberDirectoryCountSummary().textContent()) || '';
    const match = text.match(/(\d+)\s+members?\s+in\s+directory/i);
    return match ? Number(match[1]) : null;
  }

  async openRecipientDropdownOptionEmails(): Promise<string[]> {
    const control = this.recipientDropdown();
    await expect(control).toBeVisible({ timeout: 10000 });
    await control.scrollIntoViewIfNeeded();
    await control.click();

    const options = this.page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    await expect.poll(async () => options.count(), { timeout: 10000 }).toBeGreaterThan(0);

    const optionTexts = await options.allInnerTexts();
    const emails = optionTexts
      .flatMap((t) => {
        const angleMatch = t.match(/<([^>]+@[^>]+)>/);
        if (angleMatch) return [angleMatch[1]];
        const plainMatches = t.match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/g);
        return plainMatches ?? [t.trim()];
      })
      .map((e) => e.toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    await this.page.keyboard.press('Escape');
    return Array.from(new Set(emails));
  }
}

async function logoutViaNavbar(page: Page) {
  const logout = page.locator('span.ant-dropdown-menu-title-content', { hasText: 'Logout' });
  await page.click('div.navbar-container span:nth-child(2)');
  await expect(logout).toBeVisible({ timeout: 20000 });
  await logout.click({ timeout: 20000, force: true });
  await page.waitForTimeout(1500);
}

test.describe('AC-7354 Slack Integration @notifications @slack @serial', () => {
  let slackPage: SlackNotificationsPage;

  test.beforeEach(async ({ page }, testInfo) => {
    slackPage = new SlackNotificationsPage(page);
    await slackPage.goto();
    const connected = await slackPage.isConnected();
    if (!connected) {
      const snapshot = await slackPage.debugSnapshot();
      console.log(`[AC-7354] Skip diagnostic for "${testInfo.title}": ${snapshot}`);
    }
    test.skip(
      !connected,
      'Target tenant is not connected to Slack. Pre-connect the tenant manually before running this suite (see runbook at top of file).'
    );
  });

  test.describe('1. Workspaces section (AC-7354 UI)', () => {
    test('Heading reads "Connected Slack workspace"', async () => {
      const sectionHeading = slackPage.workspacesSectionHeading();
      await expect(sectionHeading, 'Workspaces section heading should be present').toBeVisible();
      await expect(
        sectionHeading,
        'AC-7354: section heading should read "Connected Slack workspace"'
      ).toHaveText(/connected slack workspace/i);
    });

    test('Exactly one workspace row, no "Add another workspace" button', async () => {
      await expect(slackPage.workspaceRows()).toHaveCount(1);
      await expect(slackPage.addAnotherWorkspaceButton()).toHaveCount(0);
    });

    test('Action button reads "Disconnect" with danger/red styling', async () => {
      const disconnect = slackPage.disconnectButton().first();
      await expect(disconnect, 'Manage button should be renamed to Disconnect').toBeVisible();
      await expect(slackPage.manageButton(), 'Manage button should no longer exist').toHaveCount(0);

      const classes = (await disconnect.getAttribute('class')) || '';
      const hasDangerClass = /danger|red/i.test(classes);
      if (!hasDangerClass) {
        const color = await disconnect.evaluate((el) => getComputedStyle(el).color);
        expect(color, 'Disconnect should be styled as a danger/red action').toMatch(
          /rgb\(\s*(2[0-5]{2}|[2-9][0-9]|1[0-9]{2})\s*,\s*[0-6][0-9]?\s*,/
        );
      }
    });

    test('Member directory card renders View and Sync actions', async ({ page }) => {
      await expect(slackPage.viewMemberDirectoryButton().first()).toBeVisible();
      await expect(slackPage.syncMemberDirectoryButton().first()).toBeVisible();
      await expect(page.getByText(/\d+ members? in directory/i)).toBeVisible();
    });

    test('Section description reads "Connected Slack workspace."', async () => {
      await expect(
        slackPage.oldWorkspacesDescription(),
        'AC-7354: old "Set one as active..." description should be removed'
      ).toHaveCount(0);
      await expect(
        slackPage.newWorkspacesDescription(),
        'AC-7354: section description should read "Connected Slack workspace."'
      ).toBeVisible();
    });

    test('Workspace row shows name, team ID, and "Active workspace" label', async ({ page }) => {
      const header = slackPage.workspaceNameLabel().first();
      await expect(header).toBeVisible();
      await expect(header, 'Workspace name should be present in the collapse header').toHaveText(
        /[a-z0-9][a-z0-9_-]{2,}/i
      );
      await expect(
        page.getByText(/active workspace for test notifications/i).first(),
        'Active workspace indicator should render'
      ).toBeVisible();
    });

    test('Member directory snapshot banner copy', async () => {
      await expect(
        slackPage.memberDirectorySnapshotBanner(),
        'Snapshot banner copy should match the spec'
      ).toBeVisible();
    });

    test('Member count in workspace card matches View Member Directory modal', async () => {
      const cardCount = await slackPage.memberCountFromWorkspaceCard();
      const modalCount = await slackPage.memberCountFromModal();
      expect(cardCount, 'Card should expose a numeric member count').not.toBeNull();
      expect(modalCount, 'Modal should expose a numeric member count').not.toBeNull();
      expect(modalCount).toBe(cardCount);
    });
  });

  test.describe('2. Delivery channel', () => {
    test('Renders all three delivery options', async () => {
      await expect(slackPage.deliveryRadio('email')).toBeVisible();
      await expect(slackPage.deliveryRadio('slack')).toBeVisible();
      await expect(slackPage.deliveryRadio('both')).toBeVisible();
    });

    test('Selecting Slack only updates the info banner copy', async ({ page }) => {
      await slackPage.deliveryRadio('slack').click();
      await expect(page.getByText(/using slack only/i)).toBeVisible({ timeout: 5000 });
    });

    test('Email only banner copy', async ({ page }) => {
      await slackPage.deliveryRadio('email').click();
      await expect(page.getByText(/using email only/i).first()).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByText(/notifications are sent by\s+email\s+only;?\s+no slack messages are sent/i).first()
      ).toBeVisible();
    });

    test('Slack only banner copy', async ({ page }) => {
      await slackPage.deliveryRadio('slack').click();
      await expect(page.getByText(/using slack only/i).first()).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByText(/no emails are sent.*notifications are delivered as\s+slack messages only/is).first()
      ).toBeVisible();
      await expect(
        page.getByText(/email on the accrual.*matches someone in your\s+slack member directory/is).first()
      ).toBeVisible();
      await expect(
        page.getByText(/if there's no match, that person won't receive this notification/i).first()
      ).toBeVisible();
    });

    test('Email + Slack banner copy', async ({ page }) => {
      await slackPage.deliveryRadio('both').click();
      await expect(page.getByText(/using email and slack/i).first()).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByText(/we send both\s+email\s+and\s+slack messages/i).first()
      ).toBeVisible();
      await expect(
        page.getByText(/email on the accrual\s+is\s+found in your\s+slack member directory/is).first()
      ).toBeVisible();
      await expect(
        page.getByText(/if there's no slack match, we won't dm that person.*they can still receive\s+email/is).first()
      ).toBeVisible();
    });

    test('Changing selection without saving surfaces dirty state', async () => {
      const initial = await slackPage.currentDelivery();
      const target: 'email' | 'slack' = initial === 'slack' ? 'email' : 'slack';
      await slackPage.deliveryRadio(target).click();
      await expect(
        slackPage.deliveryRadio(target),
        'Radio should register the click'
      ).toBeChecked({ timeout: 3000 });

      // Dirty state can surface as either a visible "unsaved changes" banner OR an
      // enabled Save button (baseline is disabled when nothing has changed).
      const banner = slackPage.unsavedDeliveryBanner();
      const save = slackPage.saveButton();
      await expect
        .poll(
          async () => {
            const bannerVisible = await banner.isVisible().catch(() => false);
            const saveEnabled = await save.isEnabled().catch(() => false);
            return bannerVisible || saveEnabled;
          },
          { timeout: 5000, intervals: [250, 500, 1000] }
        )
        .toBeTruthy();
    });

    test('Save persists the selection and clears the unsaved banner', async ({ page }) => {
      await slackPage.deliveryRadio('email').click();
      const save = slackPage.saveButton();
      if (await save.isEnabled().catch(() => false)) {
        await save.click();
      }
      await expect(slackPage.unsavedDeliveryBanner()).toHaveCount(0, { timeout: 10000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(slackPage.deliveryRadio('email')).toBeChecked();
    });
  });

  test.describe('3. Test notification', () => {
    test('Callout names the connected workspace', async ({ page }) => {
      await expect(slackPage.testNotificationCallout()).toBeVisible();
      const workspaceName = await slackPage.connectedWorkspaceName();
      if (workspaceName) {
        await expect(page.getByText(workspaceName, { exact: false }).first()).toBeVisible();
      }
    });

    test('User dropdown options match the member directory', async () => {
      const directoryEmails = await slackPage.memberDirectoryEmailsFromModal();
      expect(directoryEmails.length, 'Member directory must not be empty').toBeGreaterThan(0);

      const dropdownEmails = await slackPage.openRecipientDropdownOptionEmails();
      expect(dropdownEmails.length, 'Recipient dropdown must not be empty').toBeGreaterThan(0);

      for (const email of dropdownEmails) {
        expect(directoryEmails, `Dropdown email ${email} should exist in Member Directory`).toContain(
          email
        );
      }
    });

    test('Send button is disabled until a recipient is selected', async () => {
      await expect(slackPage.sendTestNotificationButton()).toBeDisabled();
    });

    test('Section headings and instructional copy', async ({ page }) => {
      await expect(
        page.getByRole('heading', { name: /^test notification$/i }).first(),
        'Section heading should read "Test notification"'
      ).toBeVisible();
      await expect(
        page.getByText(/verify that your slack notifications are working correctly/i).first()
      ).toBeVisible();
      await expect(
        page.getByText(/choose one or more users below to receive a direct-message test notification/i).first()
      ).toBeVisible();
      await expect(
        page.getByText(
          /the message sent will be:\s*\[test\] slack integration test from gappify\. if you see this, notifications are working\./i
        ).first()
      ).toBeVisible();
    });

    test('Callout includes the actual connected workspace name', async ({ page }) => {
      const workspaceName = await slackPage.connectedWorkspaceName();
      expect(workspaceName, 'Should be able to read the connected workspace name').not.toBeNull();
      const callout = slackPage.testNotificationCallout();
      await expect(callout).toBeVisible();
      const escaped = workspaceName!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(
        page.getByText(new RegExp(escaped, 'i')).first(),
        'Workspace name from the Workspaces section should appear in the Test notification section'
      ).toBeVisible();
    });

    test('Test recipients counter updates when users are selected', async ({ page }) => {
      await expect(
        page.getByText(/no users selected yet\s*—\s*choose at least one user below/i).first()
      ).toBeVisible();

      const control = slackPage.recipientDropdown();
      await control.scrollIntoViewIfNeeded();
      await control.click();
      const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
      await expect.poll(async () => options.count(), { timeout: 10000 }).toBeGreaterThan(0);
      await options.first().click();
      await page.keyboard.press('Escape');

      await expect(
        page.getByText(/\d+\s+users?\s+selected for this test\s*\(max\s*500\)/i).first(),
        'Counter copy should reflect at least one selected user with the (max 500) hint'
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByRole('button', { name: /clear test selection/i }).first()
      ).toBeVisible();
      await expect(slackPage.sendTestNotificationButton()).toBeEnabled();
    });
  });

  test.describe('4. Disconnect → reconnect (connection flow only)', () => {
    test.skip(
      process.env.SLACK_TEST_DISCONNECT !== 'true',
      'Disconnect flow is destructive to the tenant Slack state. Set SLACK_TEST_DISCONNECT=true to opt in; reconnect Slack manually afterward.'
    );

    test('Disconnect removes the workspace and surfaces Connect CTA', async ({ page }) => {
      await slackPage.disconnectButton().first().click();
      const confirm = page.getByRole('button', { name: /confirm|disconnect|yes/i }).last();
      if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirm.click();
      }
      await expect(slackPage.connectButton().first()).toBeVisible({ timeout: 15000 });
      await expect(slackPage.workspaceRows()).toHaveCount(0);
    });

    test('Connect button redirects to Slack OAuth consent URL', async ({ page }) => {
      await slackPage.connectButton().first().click();
      await expect
        .poll(() => page.url(), { timeout: 15000, intervals: [500, 1000, 2000] })
        .toMatch(/slack\.com\/oauth/i);
    });
  });

  test.describe('5. Non-admin (TRD) access control', () => {
    test('Non-admin cannot access Slack Notifications settings', async ({ page }) => {
      await logoutViaNavbar(page);
      await page.goto(getLoginUrl(), { timeout: 20000, waitUntil: 'domcontentloaded' });
      await loginByUI(page, TRD_EMAIL, TRD_PASSWORD);

      await page.goto('/settings/integrations/slack', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      const slackHeading = page.getByRole('heading', { name: /connected slack workspace|integrate slack/i });
      await expect(slackHeading, 'Non-admin must NOT see the Slack Notifications page').toHaveCount(0);

      const sideNavSlackEntry = page.getByRole('link', { name: /slack notifications?|integrate slack/i });
      await expect(sideNavSlackEntry, 'Non-admin should not see Slack in the settings sidebar').toHaveCount(0);
    });
  });
});
