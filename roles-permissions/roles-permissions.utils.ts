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
  });
}

async function verifySettings(
  session: RoleSession,
  suite: RolesPermissionsSuite,
  roleName: string
) {
  const access = getRoleAccess(suite, roleName, 'Settings');

  await baseTest.step('Settings', async () => {
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
  });
}

async function verifyInsights(
  session: RoleSession,
  roleName: string
) {
  const access = getRoleAccess('conso', roleName, 'Insights');

  await baseTest.step('Insights', async () => {
    if (access.page) {
      await session.page.goto('/analytics', { waitUntil: 'domcontentloaded' });
      await expect(session.page).toHaveURL(/\/analytics/);
    } else {
      await session.page.goto('/analytics', { waitUntil: 'domcontentloaded' });
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
