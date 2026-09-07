import { defineConfig, devices } from '@playwright/test';

/**
 * Browser regression coverage.
 *
 * ── Read this before assuming it passed ──────────────────────────────────
 * These specs have NOT been executed. They were written in an environment
 * with no browser binary, where Playwright's download host is blocked at the
 * egress proxy (`cdn.playwright.dev` → 403 host_not_allowed). Anyone can run
 * them where the network allows:
 *
 *     npm run test:e2e:install     # one-off browser download
 *     npm run dev                  # or let webServer below start it
 *     npm run test:e2e
 *
 * ── Why Playwright at all ────────────────────────────────────────────────
 * The reported defect was invisible to every check the repo already had. It
 * did not throw, did not log, did not fail typecheck, lint or build. It was a
 * GEOMETRY failure, and geometry needs a layout engine. jsdom has none, so the
 * vitest suite can only assert that the card layout is wired up — not that a
 * word survives intact at 320px. That gap is what this file closes.
 *
 * The projects below are the viewport list from the brief, trimmed to the ones
 * that exercise a distinct branch: the smallest phone still shipping, a
 * mid-size Android, the iPhone safe-area case, the tablet band where the
 * single `md:` breakpoint used to be the only treatment, and desktop.
 */

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? 'http://localhost:5173/aqua/';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: '320', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 }, isMobile: false, hasTouch: true } },
    { name: '360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 }, hasTouch: true } },
    { name: '390-ios', use: { ...devices['iPhone 14'] } },
    { name: '412', use: { ...devices['Pixel 7'] } },
    { name: '430', use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 }, hasTouch: true } },
    { name: '768-tablet', use: { ...devices['iPad Mini'] } },
    { name: '1024-tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 1366 } } },
    { name: '1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: '1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: process.env.AQUA_E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
