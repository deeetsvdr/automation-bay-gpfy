import { expect, Locator, Page, Response, test as baseTest } from '@playwright/test';
import { AccrualManagerPage } from '@shared/pages/AccrualManagerPage';
import { QjePage } from '@shared/pages/QjePage';
import { ReviewCenterPage } from '@shared/pages/ReviewCenterPage';
import { ScheduleManagerPage } from '@shared/pages/ScheduleManagerPage';
import { TransactionColumnManagerPage } from '@shared/pages/TransactionColumnManagerPage';
import { TransactionManagerPage } from '@shared/pages/TransactionManagerPage';
import {
  createRoleSession,
  getRoleConfig,
  getRoleNames,
  RoleSession,
  RolesPermissionsSuite,
} from '@shared/helpers/api/rolesAndPermissionsHelper';

export const suiteLabels: Record<RolesPermissionsSuite, string> = {
  conso: 'Conso',
  trd: 'TRD',
};

export function getSuiteRoleNames(suite: RolesPermissionsSuite): string[] {
  const roleNames = getRoleNames(suite);

  // Preserve the source Cypress behavior for TRD.
  if (suite === 'trd') {
    return roleNames.filter((roleName) => roleName !== 'GappifyAdministrator');
  }

  return roleNames;
}

export function getRoleAccess(
  suite: RolesPermissionsSuite,
  roleName: string,
  area:
    | 'Accrual Manager'
    | 'Transaction Manager'
    | 'Settings'
    | 'QJE'
    | 'Review Center'
    | 'Insights'
): Record<string, boolean> {
  return getRoleConfig(suite, roleName).access[area]?.functions || {};
}

export async function createSuiteRoleSession(
  browser: Parameters<typeof createRoleSession>[0],
  suite: RolesPermissionsSuite,
  roleName: string
): Promise<RoleSession> {
  return createRoleSession(browser, suite, roleName);
}

export async function expectLocatorState(
  locator: Locator,
  enabled: boolean,
  visible: boolean = true
) {
  if (visible) {
    await expect(locator).toBeVisible();
  }

  if (enabled) {
    await expect(locator).toBeEnabled();
  } else {
    await expect(locator).toBeDisabled();
  }
}

export async function expectVisibleWhenAllowed(
  locator: Locator,
  allowed: boolean
) {
  if (allowed) {
    await expect(locator).toBeVisible();
    return;
  }

  const count = await locator.count();
  if (!count) {
    return;
  }

  await expect(locator).toBeDisabled();
}

const incompleteIndicatorVisibleRoles = new Set([
  'Full User',
  'System Administrator',
  'Task Manager',
  'GappifyAdministrator',
  'QJE Manager',
  'Read-Only User',
  'Transaction Manager',
  'Close Manager',
]);

function dropdownHasOption(options: string[], optionText: string): boolean {
  return options.some((option) => option.includes(optionText));
}

async function closeDropdown(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});
}

async function getOpenDropdownOptions(page: Page): Promise<string[]> {
  const items = page.locator('.ant-dropdown:visible .ant-dropdown-menu-title-content');
  const count = await items.count();
  const options: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const text = (await items.nth(index).innerText()).trim();
    if (text) {
      options.push(text);
    }
  }

  return options;
}

async function readDropdownOptions(
  page: Page,
  trigger: Locator
): Promise<string[] | null> {
  if (!(await trigger.count())) {
    return null;
  }

  if (!(await trigger.isVisible().catch(() => false))) {
    return null;
  }

  if (!(await trigger.isEnabled().catch(() => false))) {
    return null;
  }

  await trigger.click();
  await page.locator('.ant-dropdown:visible').first().waitFor({
    state: 'visible',
    timeout: 5000,
  });

  const options = await getOpenDropdownOptions(page);
  await closeDropdown(page);
  return options;
}

async function expectDropdownOptionPermission(
  page: Page,
  trigger: Locator,
  optionText: string,
  allowed: boolean
) {
  const options = await readDropdownOptions(page, trigger);

  if (!options) {
    return;
  }

  if (!allowed) {
    expect(
      dropdownHasOption(options, optionText),
      `Expected dropdown option "${optionText}" to be hidden when permission is false`
    ).toBe(false);
  }
}

async function expectMenuOptionState(
  page: Page,
  optionText: string,
  allowed: boolean
) {
  const option = page.locator('.ant-dropdown:visible li').filter({ hasText: optionText }).first();
  await expect(option).toBeVisible();

  const ariaDisabled = await option.getAttribute('aria-disabled');
  expect(ariaDisabled === 'true').toBe(!allowed);
}

async function expectBodyTextIncludes(page: Page, expectedText: string) {
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toContain(expectedText);
}

async function expectTabState(
  locator: Locator,
  allowed: boolean
) {
  const count = await locator.count();

  if (allowed) {
    expect(count).toBeGreaterThan(0);
    await expect(locator.first()).toBeVisible();
    return;
  }

  expect(count).toBe(0);
}

export async function gotoAndCapture(
  page: Page,
  url: string,
  responseMatcher: (response: Response) => boolean
): Promise<Response | null> {
  const responsePromise = page
    .waitForResponse(responseMatcher, { timeout: 30000 })
    .catch(() => null);

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  return responsePromise;
}

export async function expectForbiddenPage(page: Page) {
  await expect(page).toHaveURL(/\/error\?message=Forbidden&status=403/);
}

export async function openUserMenu(page: Page) {
  const trigger = page
    .locator('button.ant-btn.ant-btn-round.ant-btn-default.ant-dropdown-trigger')
    .filter({ has: page.locator('span[aria-label="user"]') })
    .first();

  await expect(trigger).toBeVisible();
  await trigger.click();
}

export async function assertResponseStatus(
  response: Response | null,
  expectedStatus: number
) {
  expect(
    response,
    `Expected a matching network response with status ${expectedStatus}`
  ).not.toBeNull();

  expect(response?.status()).toBe(expectedStatus);
}

export async function assertResponseOrForbidden(
  page: Page,
  response: Response | null,
  allowed: boolean
) {
  if (allowed) {
    await assertResponseStatus(response, 200);
    return;
  }

  if (response) {
    expect(response.status()).toBe(403);
    return;
  }

  await expectForbiddenPage(page);
}

async function verifyAccrualManager(
  session: RoleSession,
  suite: RolesPermissionsSuite,
  roleName: string
) {
  const access = getRoleAccess(suite, roleName, 'Accrual Manager');
  const page = new AccrualManagerPage(session.page);

  await baseTest.step('Accrual Manager', async () => {
    const importButton = session.page.getByRole('button', { name: /Import/i });
    const exportButton = session.page.getByRole('button', { name: /Export to/i });
    const linesButton = session.page.getByRole('button', { name: /Lines/i }).first();

    if (access.page) {
      await session.page.goto('/task-manager', { waitUntil: 'domcontentloaded' });
      await expect(session.page).toHaveURL(/\/task-manager/);
      await expect(exportButton).toBeVisible();
      await expect(linesButton).toBeVisible();
    } else {
      await session.page.goto('/task-manager', { waitUntil: 'domcontentloaded' });
      await expectForbiddenPage(session.page);
      return;
    }

    const importCount = await importButton.count();
    if (importCount) {
      await expectLocatorState(importButton, !!access.import);
    }

    await expectVisibleWhenAllowed(exportButton, !!access.export);
    await expectVisibleWhenAllowed(linesButton, !!access.filtering);

    const indicator = session.page.getByTestId('incomplete-line-indicator');
    if (await indicator.count()) {
      if (incompleteIndicatorVisibleRoles.has(roleName)) {
        await expect(indicator).toBeVisible();
        await session.page.getByTestId('incomplete-line-indicator-icon').hover();
        await expect(session.page.getByRole('tooltip')).toBeVisible();
      } else {
        await expect(indicator).toHaveCount(0);
      }
    }

    await expectDropdownOptionPermission(
      session.page,
      linesButton,
      'Create New Filter',
      !!access.filteringByCreateNewFilter
    );
    await expectDropdownOptionPermission(
      session.page,
      linesButton,
      'All Lines',
      !!access.filteringByAllLines
    );
    await expectDropdownOptionPermission(
      session.page,
      linesButton,
      'Active Lines',
      !!access.filteringByActiveLines
    );
    await expectDropdownOptionPermission(
      session.page,
      linesButton,
      'Inactive Lines',
      !!access.filteringByInactiveLines
    );

    if (
      access.filtering &&
      access.filteringByCreateNewFilter &&
      (await linesButton.isEnabled().catch(() => false))
    ) {
      await linesButton.click();
      await session.page
        .locator('.ant-dropdown:visible .ant-dropdown-menu-title-content')
        .filter({ hasText: 'Create New Filter' })
        .first()
        .click();
      await expectBodyTextIncludes(session.page, 'Create Filter');
      await expectBodyTextIncludes(session.page, 'Filter Name');
      await expectBodyTextIncludes(session.page, 'Filter Criteria');
      await expectBodyTextIncludes(session.page, 'Add Filter');
      await expectBodyTextIncludes(session.page, 'Preview');
      await session.page.getByRole('button', { name: 'Cancel' }).click();
    }

    await openUserMenu(session.page);
    await expectMenuOptionState(session.page, 'Upload files', !!access.uploadFiles);
    await expectMenuOptionState(session.page, 'Settings', !!access.settings);
    await closeDropdown(session.page);
  });
}

async function verifySettings(
  session: RoleSession,
  suite: RolesPermissionsSuite,
  roleName: string
) {
  const access = getRoleAccess(suite, roleName, 'Settings');

  await baseTest.step('Settings', async () => {
    await session.page.goto('/settings', {
      waitUntil: 'domcontentloaded',
    });
    await expect(session.page).toHaveURL(/\/settings/);

    await session.page.goto('/settings/user-management/users', {
      waitUntil: 'domcontentloaded',
    });
    if (access.userManagementUsers) {
      await expect(session.page).toHaveURL(/\/settings\/user-management\/users/);
    } else {
      const response = await session.page.waitForResponse(
        (res) => res.url().includes('/settings/user-management/users') || res.url().includes('/users?sort=asc&page=1'),
        { timeout: 10000 }
      ).catch(() => null);
      if (response) {
        expect(response.status()).toBe(403);
      }
    }

    await session.page.goto('/settings/user-management/sso', {
      waitUntil: 'domcontentloaded',
    });
    if (access.userManagementSSO) {
      await expect(session.page).toHaveURL(/\/settings\/user-management\/sso/);
    }

    await session.page.goto('/settings/user-management/login-audit-trail', {
      waitUntil: 'domcontentloaded',
    });
    if (access.userManagementLoginAuditTrail) {
      await expect(session.page).toHaveURL(/\/settings\/user-management\/login-audit-trail/);
    }

    if (access.scheduleManager) {
      const page = new ScheduleManagerPage(session.page);
      await page.goTo();
      await expect(session.page).toHaveURL(/\/settings\/schedule-manager/);
    }

    await session.page.goto('/settings/period-management', {
      waitUntil: 'domcontentloaded',
    });
    if (access.periodManagement) {
      await expect(session.page).toHaveURL(/\/settings\/period-management/);
    }

    if (suite === 'conso' && access.transactionsColumnManager) {
      const page = new TransactionColumnManagerPage(session.page);
      await page.goto();
      await expect(page.columnTable.table).toBeVisible();
    }

    const accrualRulesResponse = await gotoAndCapture(
      session.page,
      '/settings/accrual-rules',
      (res) => res.url().includes('/api/accrual-rules')
    );

    if (access.accrualRules) {
      await assertResponseStatus(accrualRulesResponse, 200);
    } else if (accrualRulesResponse) {
      expect(accrualRulesResponse.status()).toBe(403);
    }
  });
}

async function verifyTransactionManager(
  session: RoleSession,
  suite: RolesPermissionsSuite,
  roleName: string
) {
  const access = getRoleAccess(suite, roleName, 'Transaction Manager');
  const page = new TransactionManagerPage(session.page);

  await baseTest.step('Transaction Manager', async () => {
    if (access.page) {
      await page.goto();
      await expect(session.page).toHaveURL(/\/transactions-consolidated\/lines/);
      await expect(page.periodDropdown.triggerButton).toBeVisible();
    } else {
      await session.page.goto('/transactions-consolidated/lines', {
        waitUntil: 'domcontentloaded',
      });
      await expectForbiddenPage(session.page);
      return;
    }

    await expectVisibleWhenAllowed(page.addNewLineButton.button, !!access.addNewLine);
    await expectVisibleWhenAllowed(page.createQjeButton.button, !!access.createQJE);
    await expectVisibleWhenAllowed(page.noQjeButton.button, !!access.noQJE);

    const quickSearch = session.page.locator('input[placeholder*="Search"]').first();
    await expectVisibleWhenAllowed(quickSearch, !!access['quick-search']);

    await expectTabState(session.page.getByTestId('attachments-tab'), !!access.attachments);
    await expectTabState(session.page.getByTestId('comment-tab'), !!access.comments);
    await expectTabState(session.page.getByTestId('history-tab'), !!access.history);

    const filterOptions = await readDropdownOptions(session.page, page.filterDropdown.triggerButton);
    if (filterOptions) {
      if (!access.filteringCreateNewFilter) {
        expect(dropdownHasOption(filterOptions, 'Create New Filter')).toBe(false);
      }
      if (!access.filteringByAllLines) {
        expect(dropdownHasOption(filterOptions, 'All Lines')).toBe(false);
      }
      if (!access.filteringByLinesWithAmountGreaterThan0) {
        expect(dropdownHasOption(filterOptions, 'Amount Greater than 0.00')).toBe(false);
      }
      if (!access.filteringByRejectedLines) {
        expect(dropdownHasOption(filterOptions, 'Rejected Lines')).toBe(false);
      }
      if (!access.filteringByOverridenLines) {
        expect(dropdownHasOption(filterOptions, 'Overridden Lines')).toBe(false);
      }
      if (!access.filteringByLinesWithError) {
        expect(dropdownHasOption(filterOptions, 'Lines with Errors')).toBe(false);
      }
    }
  });
}

async function verifyQje(
  session: RoleSession,
  suite: RolesPermissionsSuite,
  roleName: string
) {
  const access = getRoleAccess(suite, roleName, 'QJE');
  const page = new QjePage(session.page);

  await baseTest.step('QJE', async () => {
    if (access.pageReviewJE) {
      await page.goto();
      await expect(session.page).toHaveURL(/\/qje2\/review-je/);
      await expect(session.page.getByTestId('global-filter-panel-period-dropdown-btn')).toBeVisible();
    } else {
      await session.page.goto('/qje2/review-je', { waitUntil: 'domcontentloaded' });
      await expectForbiddenPage(session.page);
      return;
    }

    const filterTrigger = session.page.getByRole('button', { name: /All JEs|Unposted JEs|Posted JEs|Rejected JEs|Extracted JEs|Failed JEs/ }).first();
    const filterOptions = await readDropdownOptions(session.page, filterTrigger);
    if (filterOptions) {
      if (!access.filteringCreateNewFilter) {
        expect(dropdownHasOption(filterOptions, 'Create New Filter')).toBe(false);
      }
      if (!access.filteringByAllJEs) {
        expect(dropdownHasOption(filterOptions, 'All JEs')).toBe(false);
      }
      if (!access.filteringByUnpostedJEs) {
        expect(dropdownHasOption(filterOptions, 'Unposted JEs')).toBe(false);
      }
      if (!access.filteringByPostedJEs) {
        expect(dropdownHasOption(filterOptions, 'Posted JEs')).toBe(false);
      }
      if (!access.filteringByRejectedJEs) {
        expect(dropdownHasOption(filterOptions, 'Rejected JEs')).toBe(false);
      }
      if (!access.filteringByExtractedJEs) {
        expect(dropdownHasOption(filterOptions, 'Extracted JEs')).toBe(false);
      }
      if (!access.filteringByFailedJEs) {
        expect(dropdownHasOption(filterOptions, 'Failed JEs')).toBe(false);
      }
    }

    const exportOptions = await readDropdownOptions(
      session.page,
      session.page.getByTestId('global-filter-panel-export-dropdown-btn').first()
    );
    if (exportOptions) {
      if (access.export) {
        expect(dropdownHasOption(exportOptions, 'CSV')).toBe(!!access.exportByCSV);
        expect(dropdownHasOption(exportOptions, 'PDF')).toBe(!!access.exportByPDF);
        expect(dropdownHasOption(exportOptions, 'Excel')).toBe(!!access.exportByExcel);
      }
    }

    if (access.reviewPOClosure_Unreviewed) {
      await session.page.goto('/qje2/review-po-closure/unreviewed', {
        waitUntil: 'domcontentloaded',
      });
      await expect(session.page).toHaveURL(/\/qje2\/review-po-closure\/unreviewed/);
      await expect(session.page.getByTestId('global-filter-panel-period-dropdown-btn')).toBeVisible();

      const unreviewedExportOptions = await readDropdownOptions(
        session.page,
        session.page.getByTestId('global-filter-panel-export-dropdown-btn').first()
      );
      if (unreviewedExportOptions) {
        if (access.export) {
          expect(dropdownHasOption(unreviewedExportOptions, 'CSV')).toBe(!!access.exportByCSV);
          expect(dropdownHasOption(unreviewedExportOptions, 'PDF')).toBe(!!access.exportByPDF);
          expect(dropdownHasOption(unreviewedExportOptions, 'Excel')).toBe(!!access.exportByExcel);
        }
      }
    }

    if (access.reviewPOClosure_Reviewed) {
      await session.page.goto('/qje2/review-po-closure/reviewed', {
        waitUntil: 'domcontentloaded',
      });
      await expect(session.page).toHaveURL(/\/qje2\/review-po-closure\/reviewed/);
      await expect(session.page.getByTestId('global-filter-panel-period-dropdown-btn')).toBeVisible();

      const reviewedExportOptions = await readDropdownOptions(
        session.page,
        session.page.getByTestId('global-filter-panel-export-dropdown-btn').first()
      );
      if (reviewedExportOptions) {
        if (access.export) {
          expect(dropdownHasOption(reviewedExportOptions, 'CSV')).toBe(!!access.exportByCSV);
          expect(dropdownHasOption(reviewedExportOptions, 'PDF')).toBe(!!access.exportByPDF);
          expect(dropdownHasOption(reviewedExportOptions, 'Excel')).toBe(!!access.exportByExcel);
        }
      }
    }
  });
}

async function verifyReviewCenter(
  session: RoleSession,
  suite: RolesPermissionsSuite,
  roleName: string
) {
  const access = getRoleAccess(suite, roleName, 'Review Center');
  const page = new ReviewCenterPage(session.page);

  await baseTest.step('Review Center', async () => {
    if (access.page) {
      await page.goto();
      await expect(session.page).toHaveURL(/\/review-center/);
      await expect(page.periodDropdown.triggerButton).toBeVisible();
    } else {
      await session.page.goto('/review-center', { waitUntil: 'domcontentloaded' });
      await expectForbiddenPage(session.page);
    }

    await expectVisibleWhenAllowed(page.filterDropdown.triggerButton, !!access.filtering);
    await expectVisibleWhenAllowed(page.viewDropdown.triggerButton, !!access.viewDowndown);
    await expectVisibleWhenAllowed(page.exportDropdown.triggerButton, !!access.export);

    const filterOptions = await readDropdownOptions(session.page, page.filterDropdown.triggerButton);
    if (filterOptions) {
      if (!access.filteringAll) {
        expect(dropdownHasOption(filterOptions, 'All')).toBe(false);
      }
      if (!access.filtering) {
        expect(dropdownHasOption(filterOptions, 'Create New Filter')).toBe(false);
      }
    }

    const viewOptions = await readDropdownOptions(session.page, page.viewDropdown.triggerButton);
    if (viewOptions) {
      expect(viewOptions.length).toBeGreaterThan(0);
    }

    const exportOptions = await readDropdownOptions(session.page, page.exportDropdown.triggerButton);
    if (exportOptions) {
      if (access.export) {
        expect(exportOptions.length).toBeGreaterThan(0);
      }
    }
  });
}

async function verifyInsights(
  session: RoleSession,
  roleName: string
) {
  const access = getRoleAccess('conso', roleName, 'Insights');

  await baseTest.step('Insights', async () => {
    if (access.page) {
      await session.page.goto('/insights?confirmation-response-rates=Vendor', {
        waitUntil: 'domcontentloaded',
      });
      await expect(session.page).toHaveURL(/confirmation-response-rates=Vendor/);

      await session.page.goto('/insights?confirmation-response-rates=Internal', {
        waitUntil: 'domcontentloaded',
      });
      await expect(session.page).toHaveURL(/confirmation-response-rates=Internal/);

      await session.page.goto('/insights?confirmation-response-rates=Vendor', {
        waitUntil: 'domcontentloaded',
      });
      await expect(session.page).toHaveURL(/confirmation-response-rates=Vendor/);
    } else {
      await session.page.goto('/insights', { waitUntil: 'domcontentloaded' });
      await expectForbiddenPage(session.page);
    }
  });
}

export function defineRolesPermissionsSuite(
  test: typeof baseTest,
  suite: RolesPermissionsSuite
) {
  test.describe(`${suiteLabels[suite]} roles and permissions @rolesPermissions`, () => {
    for (const roleName of getSuiteRoleNames(suite)) {
      test.describe(`${suiteLabels[suite]} ${roleName}`, () => {
        let session: RoleSession;

        test.beforeAll(async ({ browser }) => {
          session = await createSuiteRoleSession(browser, suite, roleName);
        });

        test.afterAll(async () => {
          if (session) {
            await session.dispose();
          }
        });

        test(`verifies ${suiteLabels[suite]} permissions for ${roleName} @rolesPermissions`, async () => {
          await verifyAccrualManager(session, suite, roleName);
          await verifySettings(session, suite, roleName);
          await verifyTransactionManager(session, suite, roleName);
          await verifyQje(session, suite, roleName);
          await verifyReviewCenter(session, suite, roleName);

          if (suite === 'conso') {
            await verifyInsights(session, roleName);
          }
        });
      });
    }
  });
}
