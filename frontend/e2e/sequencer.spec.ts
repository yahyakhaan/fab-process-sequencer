import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function loadFastSample(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Simulator connected')).toBeVisible();
  await page.getByRole('button', { name: 'Load sample' }).click();
  await expect(page.getByRole('article')).toHaveCount(3);

  const durationInputs = page.locator('input[name="duration_sec"]');
  for (let index = 0; index < await durationInputs.count(); index += 1) {
    await durationInputs.nth(index).fill('1');
  }
}

test('runs a complete sample recipe and displays live telemetry', async ({ page }) => {
  await loadFastSample(page);

  const runButton = page.getByRole('button', { name: 'Run simulation' });
  await expect(runButton).toBeEnabled();
  await runButton.click();

  await expect(page.getByText('Run completed', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Run completed successfully.')).toBeVisible();
  await expect(page.getByText(/^Run run-\d+ complete$/)).toBeVisible();
  await expect(page.getByRole('img', { name: /plot for/i })).toBeVisible();
});

test('surfaces an injected equipment fault and unlocks the editor', async ({ page }) => {
  await loadFastSample(page);
  await page.getByLabel(/Failure demo/).selectOption('tool_fault');
  await page.getByRole('button', { name: 'Run simulation' }).click();

  await expect(page.getByText('Run failed')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('alert')).toContainText('Simulated interlock trip');
  await expect(page.getByRole('button', { name: 'Run simulation' })).toBeEnabled();
});

test('supports drag, drop, and removal at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('Simulator connected')).toBeAttached();

  const spinCoat = page.getByRole('button', { name: /Spin Coat/ });
  const canvas = page.getByRole('region', { name: 'Recipe canvas' });
  await spinCoat.dragTo(canvas, { targetPosition: { x: 190, y: 280 } });
  await expect(page.getByRole('article', { name: 'Spin Coat process step' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete Spin Coat' }).click();
  await expect(page.getByRole('heading', { name: 'Build your first process recipe' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test('recovers after a heartbeat timeout', async ({ page }) => {
  let connectionCount = 0;
  await page.clock.install();
  await page.routeWebSocket('ws://127.0.0.1:3000/ws', (connection) => {
    const serverConnection = connection.connectToServer();
    connectionCount += 1;
    if (connectionCount === 1) {
      serverConnection.onMessage((message) => {
        if (
          typeof message === 'string'
          && JSON.parse(message).type === 'connection_ready'
        ) {
          connection.send(message);
        }
      });
    }
  });

  await page.goto('/');
  await expect(page.getByText('Simulator connected')).toBeVisible();

  await page.clock.runFor(60_000);
  await expect(page.getByText('Simulator heartbeat timed out')).toBeVisible();
  await expect(page.getByText('Simulator connection closed')).toBeVisible();
  await page.clock.runFor(11_000);
  await expect.poll(() => connectionCount).toBeGreaterThan(1);
  await expect(page.getByText('Simulator connected')).toBeVisible();
});
