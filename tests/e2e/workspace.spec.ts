import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const password = "Test-only Vector password 2026!";
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.test`;
const patch = "diff --git a/src/Target.sol b/src/Target.sol\n--- a/src/Target.sol\n+++ b/src/Target.sol\n@@ -1 +1 @@\n-contract Target {}\n+contract Target { uint256 value; }\n";
const e2eAdminSessionToken = Buffer.alloc(32, 7).toString("base64url");

async function provisionInvitation(request: APIRequestContext, email: string, origin: string): Promise<string> {
  const headers = { origin, cookie: `vector_pilot_session=${e2eAdminSessionToken}` };
  const invitation = await request.post("/api/pilot/auth/invitations", { data: { email }, headers });
  if (!invitation.ok()) throw new Error(`E2E invitation failed: ${await invitation.text()}`);
  const result = await invitation.json() as { token?: string };
  if (!result.token) throw new Error("E2E invitation response did not include a token");
  return result.token;
}

async function verifySignup(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const mailbox = await request.get(`/api/pilot/auth/e2e-mailbox?email=${encodeURIComponent(email)}`);
  if (!mailbox.ok()) throw new Error(`E2E mailbox read failed: ${await mailbox.text()}`);
  const result = await mailbox.json() as { messages?: Array<{ type: string; url: string }> };
  const message = result.messages?.find(candidate => candidate.type === "email-verification");
  if (!message) throw new Error("E2E mailbox did not contain a verification message");
  const link = new URL(message.url);
  await page.goto(`${link.pathname}${link.search}`);
  await expect(page.getByRole("heading", { name: "From brief to proof." })).toBeVisible();
}

async function signup(page: Page, request: APIRequestContext, email = uniqueEmail("sponsor"), name = "Pilot Sponsor") {
  await page.goto("/workspace");
  const invitationToken = await provisionInvitation(request, email, new URL(page.url()).origin);
  await page.goto(`/workspace?invite=${encodeURIComponent(invitationToken)}`);
  await page.getByRole("tab", { name: "Sign up" }).click();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await expect(page.getByLabel(/Invitation token/)).toHaveValue(invitationToken);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verify your email." })).toBeVisible();
  await verifySignup(page, request, email);
  return email;
}

async function referenceDraft(page: Page, title: string) {
  await page.getByRole("button", { name: "Start reference exercise" }).click();
  await page.getByLabel("Task title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

async function submitExample(page: Page) {
  await page.getByRole("button", { name: "Load example patch" }).click();
  await expect(page.getByLabel("Git patch", { exact: true })).toHaveValue(/diff --git/);
  await page.getByLabel("Submission compute cost (USD)", { exact: true }).fill("0");
  await page.getByLabel("Submission effort (minutes)", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Submit patch", exact: true }).click();
  await expect(page.getByRole("article", { name: "Submission by Pilot Sponsor" })).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("landing leads to real signup, session restoration, navigation and login", async ({ page, isMobile, request }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open workspace", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Make it your workspace." })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "highlighted fields" })).toBeVisible();
  const email = await signup(page, request);
  await page.reload();
  await expect(page.getByRole("heading", { name: "From brief to proof." })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `test-results/workspace-${test.info().project.name}.png`, fullPage: true });
  if (isMobile) {
    await page.screenshot({ path: "test-results/workspace-mobile-viewport.png" });
    const heading = await page.getByRole("heading", { name: "From brief to proof." }).boundingBox();
    const navigation = await page.getByRole("complementary", { name: "Workspace sidebar" }).boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(navigation!.y + navigation!.height);
  }
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await nav.getByRole("link", { name: "Guide" }).click();
  await expect(page.getByRole("heading", { name: /Know what the evidence means/ })).toBeVisible();
  await noOverflow(page);
   await nav.getByRole("link", { name: "Tasks" }).click();
   await expect(page.getByRole("heading", { name: "Your tasks.", exact: true })).toBeVisible();
   await nav.getByRole("link", { name: "Network" }).click();
   await expect(page.getByRole("heading", { name: /Work with a/ })).toBeVisible();
   await expect(page.getByRole("tab", { name: /Find briefs/ })).toBeVisible();
   await nav.getByRole("link", { name: "Profile" }).click();
   await expect(page.getByRole("heading", { name: /Your profile/ })).toBeVisible();
   await expect(page.getByRole("heading", { name: "API tokens", exact: true })).toBeVisible();
   await nav.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Work leaves a record." })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("a wrong test password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "From brief to proof." })).toBeVisible();
});

test("reference patch runs real verification, is accepted, persists and exports", async ({ page, request }) => {
  await signup(page, request);
  const title = `Reference loop ${test.info().project.name}`;
  await referenceDraft(page, title);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByLabel("Task title", { exact: true }).fill(`${title} revised`);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${title} revised`, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Publish task", exact: true }).click();
  await expect(page.getByText("Frozen manifest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit draft", exact: true })).toHaveCount(0);
  await noOverflow(page);
  await submitExample(page);
  const article = page.getByRole("article", { name: "Submission by Pilot Sponsor" });
  await expect(article.getByRole("button", { name: "Accept submission" })).toBeDisabled();
  await article.getByRole("button", { name: "Run reference verification" }).click();
  await expect(article.getByText("Reference run", { exact: true })).toBeVisible({ timeout: 45000 });
  await expect(article.getByRole("row", { name: /Aggregate fixed calls/ })).toContainText("267,162");
  await expect(article.getByRole("row", { name: /Aggregate fixed calls/ })).toContainText("121,370");
  await expect(article.getByRole("button", { name: "Accept submission" })).toBeEnabled();
  await noOverflow(page);
  await page.screenshot({ path: `test-results/reference-evidence-${test.info().project.name}.png`, fullPage: true });
  await article.getByLabel("Review reason", { exact: true }).fill("Fixed behavioral checks and the aggregate improvement satisfy this exercise.");
  await article.getByLabel("Review time (minutes)", { exact: true }).fill("5");
  await article.getByRole("button", { name: "Accept submission" }).click();
  await expect(article.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Manual payment status", exact: true })).toHaveValue("unpaid");
  await page.getByLabel("Buyer baseline effort (minutes)", { exact: true }).fill("120");
  await page.getByLabel("Buyer setup effort (minutes)", { exact: true }).fill("15");
  await page.getByLabel("Platform service revenue (USD)", { exact: true }).fill("40");
  await page.getByLabel("Platform compute / storage / retries (USD)", { exact: true }).fill("2");
  await page.getByLabel("Platform labor (minutes)", { exact: true }).fill("10");
  await page.getByLabel("Platform hourly rate (USD/hour)", { exact: true }).fill("30");
  await page.getByRole("combobox", { name: "Manual payment status", exact: true }).selectOption("invoiced");
  await page.getByLabel("Payment / invoice reference", { exact: true }).fill("TEST ONLY invoice, no real transfer");
  await page.getByRole("button", { name: "Save ledger" }).click();
  await expect(page.getByText("100 min", { exact: true })).toBeVisible();
  const patchDownload = page.waitForEvent("download");
  await article.getByRole("link", { name: "Download original patch" }).click();
  const artifact = await patchDownload;
  expect(await readFile((await artifact.path())!, "utf8")).toContain("unchecked");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export JSON" }).click();
  const file = await jsonDownload;
  const data = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(data.task.status).toBe("accepted");
  expect(data.economics.timeSavedMinutes).toBe(100);
  expect(data.economics.platformCashUsd).toBe(38);
  expect(data.economics.platformNetUsd).toBe(33);
  expect(data.submissions[0].evidence.source).toBe("reference-run");
  const mdDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export Markdown" }).click();
  expect(await readFile((await (await mdDownload).path())!, "utf8")).toContain("no payment was transferred");
  await page.reload();
  await expect(page.getByRole("heading", { name: `${title} revised`, level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Manual payment status", exact: true })).toHaveValue("invoiced");
  await expect(page.getByText("100 min", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByLabel("Search tasks", { exact: true }).fill("not present in any task");
  await expect(page.getByRole("heading", { name: "No tasks match these filters." })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Task status", { exact: true }).selectOption("accepted");
  await expect(page.getByRole("link", { name: `Open task: ${title} revised` })).toBeVisible();
});

test("invited operators submit private patches and external reports stay unverified", async ({ page, browser, baseURL, request }) => {
  await signup(page, request);
  const operatorEmail = uniqueEmail("operator");
  const title = `External target ${test.info().project.name}`;
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "highlighted fields" })).toBeVisible();
  await page.getByLabel("Task title", { exact: true }).fill(title);
  await page.getByLabel("Task brief", { exact: true }).fill("Measured test fixture for externally supplied reports, not a real customer task.");
  await page.getByLabel("Benchmark target", { exact: true }).fill("Target.run");
  await page.getByLabel("Repository URL (HTTPS)", { exact: true }).fill("https://example.com/pilot/test-fixture");
  await page.getByLabel("Base commit (40-character SHA)", { exact: true }).fill("a".repeat(40));
  await page.getByLabel("Allowed scope paths", { exact: true }).fill("src/Target.sol");
  await page.getByLabel("Invited operator emails (optional)", { exact: true }).fill(operatorEmail);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  const taskURL = page.url();
  const id = new URL(taskURL).searchParams.get("task")!;

  const operatorContext = await browser.newContext({ baseURL });
  const operator = await operatorContext.newPage();
  await signup(operator, request, operatorEmail, "Invited Operator");
  await operator.goto(taskURL);
  await expect(operator.getByRole("alert").filter({ hasText: "access" })).toBeVisible();
  await page.getByRole("button", { name: "Publish task", exact: true }).click();
  await expect(page.getByText("Frozen manifest", { exact: true })).toBeVisible();
  await operator.reload();
  await expect(operator.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(operator.getByRole("button", { name: "Publish task" })).toHaveCount(0);
  await expect(operator.getByRole("button", { name: "Save ledger" })).toHaveCount(0);
  await operator.getByLabel("Upload patch file", { exact: true }).setInputFiles({ name: "optimization.patch", mimeType: "text/plain", buffer: Buffer.from(patch) });
  await operator.getByLabel("Method summary", { exact: true }).fill("External test fixture patch; no customer claims. <script>alert('never execute')</script>");
  await operator.getByLabel("Submission compute cost (USD)", { exact: true }).fill("1");
  await operator.getByLabel("Submission effort (minutes)", { exact: true }).fill("10");
  await operator.getByRole("button", { name: "Submit patch", exact: true }).click();
  const submission = operator.getByRole("article", { name: "Submission by Invited Operator" });
  await expect(submission).toBeVisible();
  await expect(submission.getByRole("button", { name: "Run reference verification" })).toHaveCount(0);
  await submission.getByLabel("External report JSON", { exact: true }).fill("not JSON");
  await submission.getByRole("button", { name: "Record external report", exact: true }).click();
  await expect(submission.getByRole("alert")).toContainText("invalid");
  const report = {
    environment: "TEST FIXTURE: external Foundry environment supplied manually, not executed here",
    checks: [{ name: "Reported behavior", passed: true, detail: "Test fixture report only" }],
    metrics: [{ name: "Target.run", baseline: 1000, candidate: 800 }],
    logs: ["Test-only external report"], replayCommand: "forge test --gas-report",
    limitations: ["These are E2E fixture values, not independently measured by this app"],
  };
  await submission.getByLabel("External report JSON", { exact: true }).fill(JSON.stringify(report));
  await submission.getByRole("button", { name: "Record external report", exact: true }).click();
  await expect(submission.getByText(/Operator-supplied external report/)).toBeVisible();
  await expect(submission.getByRole("button", { name: "Accept submission" })).toHaveCount(0);
  await page.reload();
  const ownerSubmission = page.getByRole("article", { name: "Submission by Invited Operator" });
  await expect(ownerSubmission.getByText(/Operator-supplied external report/)).toBeVisible();
  // A second artifact visible to the sponsor must remain hidden from the invited operator.
  await page.getByLabel("Git patch", { exact: true }).fill(patch.replace("uint256 value", "uint256 anotherValue"));
  await page.getByLabel("Method summary", { exact: true }).fill("Sponsor-only competing example; must remain private.");
  await page.getByLabel("Submission compute cost (USD)", { exact: true }).fill("0");
  await page.getByLabel("Submission effort (minutes)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Submit patch", exact: true }).click();
  await expect(page.getByRole("article", { name: "Submission by Pilot Sponsor" })).toBeVisible();
  await operator.reload();
  await expect(operator.getByRole("article", { name: "Submission by Invited Operator" })).toBeVisible();
  await expect(operator.getByRole("article", { name: "Submission by Pilot Sponsor" })).toHaveCount(0);
  // Browser fetch exercises the same Secure loopback session cookie as the real UI.
  const filtered = await operator.evaluate(async taskId => (await fetch(`/api/pilot/tasks/${taskId}`)).json(), id);
  expect(filtered.submissions).toHaveLength(1);
  expect(JSON.stringify(filtered)).not.toContain("anotherValue");
  await ownerSubmission.getByLabel("Review reason", { exact: true }).fill("Manual review of the supplied report meets the declared test-fixture threshold.");
  await ownerSubmission.getByLabel("Review time (minutes)", { exact: true }).fill("3");
  await ownerSubmission.getByRole("button", { name: "Accept submission" }).click();
  await expect(ownerSubmission.getByText("Accepted", { exact: true })).toBeVisible();
  const anonymous = await browser.newContext({ baseURL });
  expect((await anonymous.request.get(`/api/pilot/tasks/${id}`)).status()).toBe(401);
  await anonymous.close();
  await operatorContext.close();
});

test("no-improvement reference patch fails honestly and archive closes intake", async ({ page, request }) => {
  await signup(page, request);
  await referenceDraft(page, `Failure exercise ${test.info().project.name}`);
  await page.getByRole("button", { name: "Publish task" }).click();
  const candidate = await readFile("fixtures/reference/no-improvement.patch", "utf8");
  await page.getByLabel("Git patch", { exact: true }).fill(candidate);
  await page.getByLabel("Method summary", { exact: true }).fill("A deliberate no-improvement negative test, not a useful optimization.");
  await page.getByLabel("Submission compute cost (USD)", { exact: true }).fill("0");
  await page.getByLabel("Submission effort (minutes)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Submit patch", exact: true }).click();
  const submission = page.getByRole("article", { name: "Submission by Pilot Sponsor" });
  await submission.getByRole("button", { name: "Run reference verification" }).click();
  await expect(submission.getByText("Reference run", { exact: true })).toBeVisible({ timeout: 45000 });
  await expect(submission.getByRole("button", { name: "Accept submission" })).toBeDisabled();
  await expect(submission.getByRole("row", { name: /Aggregate fixed calls/ })).toContainText("0.00%");
  await submission.getByLabel("Review reason", { exact: true }).fill("The gas-identical patch does not satisfy the frozen improvement target.");
  await submission.getByLabel("Review time (minutes)", { exact: true }).fill("2");
  await submission.getByRole("button", { name: "Reject submission" }).click();
  await expect(submission.getByText("Rejected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archive task", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Patch intake", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit patch", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Submission intake is closed for this archived task.")).toBeVisible();
});
