import { defineConfig } from '@playwright/test';

// Real-browser acceptance tests for the controls work (gamepad, touch wheel, gyro, horn, settings).
// The game is plain classic scripts, so it is served by tools/serve.js — no bundler involved.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8099',
    trace: 'off',
    video: 'off',
    // the perf spec reads performance.memory; Chromium only fills it in when asked to measure the heap.
    // The audio spec also needs an AudioContext that is allowed to run without a user gesture.
    launchOptions: { args: ['--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] }
  },
  webServer: {
    command: 'node tools/serve.js 8099',
    url: 'http://127.0.0.1:8099/web/index.html',
    reuseExistingServer: true,
    timeout: 30_000
  }
});
