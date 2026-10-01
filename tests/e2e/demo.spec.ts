import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => { await page.goto("/arena"); });

test("renders a responsive, accessible dashboard with no horizontal overflow", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Your command center." })).toBeVisible();
  await expect(page.getByText("$14,000.00")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/dashboard-${test.info().project.name}.png`, fullPage: true });
});

test("creates an escrow, funds it, executes the agent and releases payment", async ({ page }) => {
  await page.getByRole("button", { name: "New escrow", exact: true }).click();
  await page.getByLabel("Task name").fill("Governance analysis");
  await page.getByLabel("Task brief").fill("Analyze governance proposals and deliver a risk report.");
  await page.getByLabel("Budget (USDC)").fill("500");
  await page.getByRole("button", { name: "Create escrow", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Governance analysis");
  await page.getByRole("button", { name: "Connect to continue" }).click();
  await page.getByRole("button", { name: "Connect demo wallet" }).click();
  await expect(page.getByRole("button", { name: "Fund escrow" })).toBeVisible();
  await page.getByRole("button", { name: "Fund escrow" }).click();
  await page.getByRole("button", { name: "Confirm funding" }).click();
  await page.getByRole("button", { name: "Run Atlas" }).click();
  await expect(page.getByRole("button", { name: "Approve & release" })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Approve & release" }).click();
  await page.getByRole("button", { name: "Confirm release" }).click();
  await expect(page.getByRole("dialog")).toContainText("Payment released");
  await page.reload();
  await page.goto("/escrows");
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(page.getByRole("button", { name: /Governance analysis/ })).toBeVisible();
});

test("searches escrows and shows a useful empty state", async ({ page }) => {
  await page.goto("/escrows");
  await page.getByLabel("Search escrows").fill("does not exist");
  await expect(page.getByText("No escrows found")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("button", { name: /SEO & market intelligence/ })).toBeVisible();
});

test("disputes a review and refunds funds exactly once", async ({ page }) => {
  await page.getByRole("button", { name: /Smart contract security audit/ }).click();
  await page.getByRole("button", { name: "Connect to continue" }).click();
  await page.getByRole("button", { name: "Connect demo wallet" }).click();
  await page.getByRole("button", { name: "Open a dispute" }).click();
  await page.getByLabel("Dispute reason").fill("The submitted audit does not cover the staking module.");
  await page.getByRole("button", { name: "Submit dispute" }).click();
  await expect(page.getByRole("dialog")).toContainText("Dispute opened");
  await page.getByRole("button", { name: "Simulate refund" }).click();
  await page.getByRole("button", { name: "Confirm refund" }).click();
  await expect(page.getByRole("dialog")).toContainText("Funds refunded");
  await expect(page.getByRole("button", { name: "Simulate refund" })).toHaveCount(0);
});

test("keyboard dismissal, navigation, settings and reset work", async ({ page, isMobile }) => {
  await page.getByRole("button", { name: "New escrow", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Agent directory" }).click();
  await expect(page.getByRole("heading", { name: "Find your unfair advantage." })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByRole("status")).toContainText("Demo reset");
});
