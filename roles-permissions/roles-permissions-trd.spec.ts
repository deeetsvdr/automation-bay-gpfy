import { test } from '@playwright/test';
import { defineRolesPermissionsSuite } from './roles-permissions.utils';

test.use({ storageState: undefined });

defineRolesPermissionsSuite(test, 'trd');
