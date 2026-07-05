// The entire Relocator integration — existing test code stays unchanged.
import { test as base } from '@playwright/test';
import { withRelocator } from '@relocator/playwright';

export const test = withRelocator(base);
export { expect } from '@playwright/test';
