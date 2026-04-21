import { Browser, BrowserContext, Page, request } from '@playwright/test';
import fs from 'fs';
import { jwtDecode } from 'jwt-decode';
import consoRolesAndPermissions from '@conso/fixtures/roles-and-permissions/roles-and-permissions.json';
import trdRolesAndPermissions from '@conso/fixtures/roles-and-permissions/roles-and-permissions-trd.json';
import { setAuthState } from '@shared/utils/authState';
import { Auth } from '@shared/utils/authStateMultiple';

type SupportedEnvironment = 'dev' | 'qa' | 'staging' | 'uat' | 'prod';

type RoleCredentials = {
  username: string;
  password: string;
};

type RoleAccess = {
  name: string;
  functions: Record<string, boolean>;
};

type RoleConfig = {
  environments: Record<SupportedEnvironment, RoleCredentials>;
  access: Record<string, RoleAccess>;
};

type RolesAndPermissionsFixture = Record<string, RoleConfig>;
export type RolesPermissionsSuite = 'conso' | 'trd';

export type RoleSession = {
  suite: RolesPermissionsSuite;
  roleName: string;
  environment: SupportedEnvironment;
  config: RoleConfig;
  credentials: RoleCredentials;
  storageStatePath: string;
  token: string;
  decodedToken: Record<string, unknown>;
  context: BrowserContext;
  page: Page;
  dispose: () => Promise<void>;
};

const fixtures: Record<RolesPermissionsSuite, RolesAndPermissionsFixture> = {
  conso: consoRolesAndPermissions as RolesAndPermissionsFixture,
  trd: trdRolesAndPermissions as RolesAndPermissionsFixture,
};
const fixtureFiles: Record<RolesPermissionsSuite, string> = {
  conso: 'projects/accrual-cloud-conso/fixtures/roles-and-permissions/roles-and-permissions.json',
  trd: 'projects/accrual-cloud-conso/fixtures/roles-and-permissions/roles-and-permissions-trd.json',
};

const supportedEnvironments: SupportedEnvironment[] = [
  'dev',
  'qa',
  'staging',
  'uat',
  'prod',
];

function parseSetCookieHeader(setCookieValue: string, fallbackUrl: string) {
  const [nameValue, ...attributeParts] = setCookieValue.split(';');
  const [rawName, ...rawValueParts] = nameValue.split('=');
  const name = rawName.trim();
  const value = rawValueParts.join('=').trim();

  const attrs = new Map<string, string>();
  for (const attributePart of attributeParts) {
    const [rawKey, ...rawAttrValueParts] = attributePart.split('=');
    attrs.set(rawKey.trim().toLowerCase(), rawAttrValueParts.join('=').trim());
  }

  const cookie: {
    name: string;
    value: string;
    path?: string;
    domain?: string;
    url?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'None' | 'Strict';
  } = {
    name,
    value,
    path: attrs.get('path') || '/',
    httpOnly: attrs.has('httponly'),
    secure: attrs.has('secure'),
  };

  const sameSite = attrs.get('samesite');
  if (sameSite) {
    const normalizedSameSite =
      sameSite.toLowerCase() === 'strict'
        ? 'Strict'
        : sameSite.toLowerCase() === 'none'
          ? 'None'
          : 'Lax';
    cookie.sameSite = normalizedSameSite;
  }

  const expires = attrs.get('expires');
  if (expires) {
    const timestamp = Math.floor(new Date(expires).getTime() / 1000);
    if (!Number.isNaN(timestamp)) {
      cookie.expires = timestamp;
    }
  }

  const domain = attrs.get('domain');
  if (domain) {
    cookie.domain = domain;
  } else {
    cookie.url = fallbackUrl;
  }

  return cookie;
}

function getRotatedPassword(): string {
  if (process.env.ROLE_PASSWORD_RESET_VALUE) {
    return process.env.ROLE_PASSWORD_RESET_VALUE;
  }

  // Keep resets automatic and avoid reusing one of the last 3 passwords.
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(-10);
  return `Gap${timestamp}!aA`;
}

function persistRolePassword(
  suite: RolesPermissionsSuite,
  roleName: string,
  environment: SupportedEnvironment,
  nextPassword: string
) {
  fixtures[suite][roleName].environments[environment].password = nextPassword;
  fs.writeFileSync(
    fixtureFiles[suite],
    `${JSON.stringify(fixtures[suite], null, 2)}\n`,
    'utf8'
  );
}

type UiLoginResult =
  | { status: 'success' }
  | { status: 'reset'; nextPassword: string }
  | { status: 'invalid' }
  | { status: 'unknown'; url: string };

async function isPasswordResetPage(page: Page): Promise<boolean> {
  if (page.url().includes('/password/')) {
    return true;
  }

  const resetHeader = page.getByText(/PASSWORD RESET/i);
  return (await resetHeader.count()) > 0;
}

async function submitPasswordReset(page: Page): Promise<string> {
  const nextPassword = getRotatedPassword();
  const passwordInputs = page.locator('input[type="password"]');

  await passwordInputs.nth(0).fill(nextPassword);
  await passwordInputs.nth(1).fill(nextPassword);
  await page.getByRole('button', { name: /^Submit$/ }).click();
  await page.waitForTimeout(3000);

  return nextPassword;
}

async function performUiLoginCheck(
  browser: Browser,
  baseUrl: string,
  credentials: RoleCredentials
): Promise<UiLoginResult> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });

    const usernameField = page.locator('[data-testid="login-username-input-field"]');
    const passwordField = page.locator('[data-testid="login-password-input-field"]');
    const submitButton = page.locator('[data-testid="login-submit-btn"]');

    await usernameField.fill(credentials.username);
    await passwordField.fill(credentials.password);
    await submitButton.click();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await isPasswordResetPage(page)) {
        const nextPassword = await submitPasswordReset(page);
        return {
          status: 'reset',
          nextPassword,
        };
      }

      if (!page.url().includes('/login')) {
        return { status: 'success' };
      }

      const invalidCredentials = page.getByText('Invalid Credentials');
      if ((await invalidCredentials.count()) > 0) {
        return { status: 'invalid' };
      }

      await page.waitForTimeout(500);
    }

    return {
      status: 'unknown',
      url: page.url(),
    };
  } finally {
    await context.close();
  }
}

async function loginViaApi(
  idmsUrl: string,
  credentials: RoleCredentials
): Promise<{
  token: string;
  decodedToken: Record<string, unknown>;
  cookies: ReturnType<typeof parseSetCookieHeader>[];
}> {
  const reqContext = await request.newContext({
    baseURL: idmsUrl,
    storageState: undefined,
  });

  try {
    const response = await reqContext.post('/api/login', {
      data: {
        username: credentials.username,
        password: credentials.password,
      },
    });

    if (response.status() !== 200) {
      throw new Error(
        `Login failed for role "${credentials.username}" with status ${response.status()}`
      );
    }

    const body = await response.json();
    const token = String(body.access_token || '');

    if (!token) {
      throw new Error(`Login succeeded for role "${credentials.username}" but no access token was returned`);
    }

    const decodedToken = jwtDecode<Record<string, unknown>>(atob(token));
    const cookies = response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .map((header) => parseSetCookieHeader(header.value, idmsUrl));

    return {
      token,
      decodedToken,
      cookies,
    };
  } finally {
    await reqContext.dispose();
  }
}

function normalizeRoleName(roleName: string): string {
  return roleName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getRolesEnvironment(): SupportedEnvironment {
  const environment = (process.env.ENV || 'qa') as SupportedEnvironment;

  if (!supportedEnvironments.includes(environment)) {
    throw new Error(
      `Unsupported ENV "${environment}". Supported values: ${supportedEnvironments.join(', ')}`
    );
  }

  return environment;
}

function getFixture(suite: RolesPermissionsSuite): RolesAndPermissionsFixture {
  return fixtures[suite];
}

export function getRoleNames(suite: RolesPermissionsSuite = 'conso'): string[] {
  return Object.keys(getFixture(suite));
}

export function getRoleConfig(
  suite: RolesPermissionsSuite,
  roleName: string
): RoleConfig {
  const fixture = getFixture(suite);
  const config = fixture[roleName];

  if (!config) {
    throw new Error(
      `Unknown role "${roleName}" for suite "${suite}". Available roles: ${getRoleNames(suite).join(', ')}`
    );
  }

  return config;
}

export function getRoleCredentials(
  suite: RolesPermissionsSuite,
  roleName: string,
  environment: SupportedEnvironment = getRolesEnvironment()
): RoleCredentials {
  const config = getRoleConfig(suite, roleName);
  return config.environments[environment];
}

export function getRoleStorageStatePath(
  suite: RolesPermissionsSuite,
  roleName: string,
  environment: SupportedEnvironment = getRolesEnvironment()
): string {
  return `playwright/.auth/roles/${suite}/${environment}/${normalizeRoleName(roleName)}.json`;
}

export async function createRoleSession(
  browser: Browser,
  suite: RolesPermissionsSuite,
  roleName: string
): Promise<RoleSession> {
  const baseUrl = process.env.BASE_URL;
  const idmsUrl = process.env.IDMS;

  if (!baseUrl) {
    throw new Error('BASE_URL must be set in the environment');
  }

  if (!idmsUrl) {
    throw new Error('IDMS must be set in the environment');
  }

  const environment = getRolesEnvironment();
  const config = getRoleConfig(suite, roleName);
  const credentials = { ...getRoleCredentials(suite, roleName, environment) };

  let token = '';
  let decodedToken: Record<string, unknown> = {};
  let cookies: ReturnType<typeof parseSetCookieHeader>[] = [];
  const uiLoginResult = await performUiLoginCheck(browser, baseUrl, credentials);

  if (uiLoginResult.status === 'reset') {
    credentials.password = uiLoginResult.nextPassword;
    persistRolePassword(suite, roleName, environment, uiLoginResult.nextPassword);
  }

  try {
    const apiLogin = await loginViaApi(idmsUrl, credentials);
    token = apiLogin.token;
    decodedToken = apiLogin.decodedToken;
    cookies = apiLogin.cookies;
  } catch (error: any) {
    if (!String(error?.message || '').includes('status 401')) {
      throw error;
    }

    if (uiLoginResult.status === 'invalid') {
      throw new Error(
        `Login failed for role "${roleName}" with status 401 and the UI login returned "Invalid Credentials"`
      );
    }

    if (uiLoginResult.status === 'unknown') {
      throw new Error(
        `Login failed for role "${roleName}" with status 401 and the UI login stayed at "${uiLoginResult.url}"`
      );
    }

    throw new Error(
      `Login failed for role "${roleName}" with status 401 after UI login status "${uiLoginResult.status}"`
    );
  }

  Auth.token = token;
  Auth.decodedToken = decodedToken;
  setAuthState(token, decodedToken);

  const context = await browser.newContext({
    storageState: undefined,
    viewport: { width: 1440, height: 900 },
  });

  if (cookies.length) {
    await context.addCookies(cookies);
  }

  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({
      decoded,
      rawToken,
    }: {
      decoded: Record<string, unknown>;
      rawToken: string;
    }) => {
      localStorage.setItem('rolesAndPermissions', JSON.stringify(decoded));
      localStorage.setItem('authToken', rawToken);
      localStorage.setItem('isConsolidated', 'true');
    },
    { decoded: decodedToken, rawToken: token }
  );

  const storageStatePath = getRoleStorageStatePath(suite, roleName, environment);
  await context.storageState({ path: storageStatePath });

  return {
    suite,
    roleName,
    environment,
    config,
    credentials,
    storageStatePath,
    token,
    decodedToken,
    context,
    page,
    dispose: async () => {
      await context.close();
    },
  };
}
