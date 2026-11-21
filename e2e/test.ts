import { withFirefoxLabelledByGuard } from "@hussmartinez/sdk-config/testing/firefox-labelled-by";
import { test as base } from "@playwright/test";

/**
 * Playwright's `test`, with the family's guard against a crash in
 * Playwright's Firefox (ui#61): reading `ariaLabelledByElements` from two
 * JavaScript worlds, as a locator by role or label and axe-core do, crashes
 * the page. In Firefox, every page of a test's context drops the property
 * before its scripts run, and axe resolves `aria-labelledby` by ID instead.
 * Every end-to-end spec imports `test` from here.
 */
export const test = withFirefoxLabelledByGuard(base);
export { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
