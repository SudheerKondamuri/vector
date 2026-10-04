import { describe, expect, it } from "vitest";
import { REFERENCE_COMMIT, REFERENCE_PATH, type PilotTask } from "../../lib/pilot-types";
import {
  createWorkspaceDraft,
  filterWorkspaceTasks,
  validateWorkspaceCredentials,
  validateWorkspaceTaskDraft,
  workspaceTaskSummary,
} from "../../components/pilot/workspace-validation";

const now = new Date("2026-10-05T12:00:00.000Z");

function externalDraft() {
  return {
    ...createWorkspaceDraft("external", now),
    title: "Reduce batch processing gas",
    description: "Reduce gas for the batch processing benchmark while preserving all public behavior.",
    repoUrl: "https://github.com/example/project",
    baseCommit: "ABCDEF01".repeat(5),
    target: "Batch.process benchmark",
    scopePaths: "src/Batch.sol\nsrc/Batch.sol\ntest/Batch.t.sol",
    priceUsd: "500.25",
    operatorRewardUsd: "250",
    inviteEmails: " Operator@Example.com, operator@example.com\nsecond@example.com ",
  };
}

describe("workspace reference task preset", () => {
  it("creates a complete, zero-price reference exercise with the fixed fixture", () => {
    const result = validateWorkspaceTaskDraft(createWorkspaceDraft("reference", now), now);
    expect(result.errors).toEqual({});
    expect(result.input).toMatchObject({
      fixture: "reference", repoUrl: "", baseCommit: REFERENCE_COMMIT,
      scopePaths: [REFERENCE_PATH], priceUsd: 0, operatorRewardUsd: 0,
      minImprovementPct: 10, maxSubmissions: 5,
    });
    expect(new Date(result.input!.deadline).getTime()).toBeGreaterThan(now.getTime());
    expect(result.input!.paymentTerms).toMatch(/reference exercise/i);
    expect(result.input!.reviewTerms.length).toBeGreaterThan(10);
  });

  it.each([
    { baseCommit: "2".repeat(40) }, { scopePaths: "src/Other.sol" },
    { repoUrl: "https://github.com/example/project" }, { priceUsd: "5" },
    { operatorRewardUsd: "5" },
  ])("rejects reference fixture or zero-price terms that were changed %o", override => {
    const result = validateWorkspaceTaskDraft({ ...createWorkspaceDraft("reference", now), ...override }, now);
    expect(Object.keys(result.errors)).not.toHaveLength(0);
    expect(result.input).toBeUndefined();
  });
});

describe("external task brief validation", () => {
  it("normalizes a full brief without fetching a repository", () => {
    const result = validateWorkspaceTaskDraft(externalDraft(), now);
    expect(result.errors).toEqual({});
    expect(result.input).toMatchObject({
      fixture: "external", repoUrl: "https://github.com/example/project",
      baseCommit: "abcdef01".repeat(5),
      scopePaths: ["src/Batch.sol", "test/Batch.t.sol"],
      priceUsd: 500.25, operatorRewardUsd: 250,
      inviteEmails: ["operator@example.com", "second@example.com"],
    });
    expect(Object.keys(result.input!)).toHaveLength(16);
  });

  it.each([
    ["title", "  "], ["description", "short"], ["target", ""],
    ["repoUrl", "http://github.com/example/project"],
    ["repoUrl", "https://secret:password@example.com/project"],
    ["repoUrl", "javascript:alert(1)"], ["baseCommit", "main"],
    ["baseCommit", "a".repeat(39)], ["scopePaths", ""],
    ["scopePaths", "../secret"], ["scopePaths", "/etc/passwd"],
    ["scopePaths", "src/../../secret"], ["scopePaths", "C:\\secret"],
    ["scopePaths", "src/*.sol"], ["constraints", ""],
    ["minImprovementPct", "0"], ["minImprovementPct", "101"],
    ["minImprovementPct", "NaN"], ["deadline", "not a date"],
    ["deadline", "2020-01-01T12:00"], ["maxSubmissions", "0"],
    ["maxSubmissions", "1.5"], ["maxSubmissions", "101"],
    ["priceUsd", "-1"], ["priceUsd", "1.234"], ["priceUsd", ""],
    ["priceUsd", "Infinity"], ["operatorRewardUsd", "-5"],
    ["operatorRewardUsd", "501"], ["scopePaths", ".git/config"],
    ["scopePaths", "src/has spaces.sol"],
    ["paymentTerms", ""], ["reviewTerms", ""], ["inviteEmails", "not-an-email"],
  ])("shows a field error for invalid %s=%s", (field, value) => {
    const result = validateWorkspaceTaskDraft({ ...externalDraft(), [field]: value }, now);
    expect(result.errors[field]).toBeTruthy();
    expect(result.input).toBeUndefined();
  });

  it("permits explicitly unpaid external briefs and no invitations", () => {
    const result = validateWorkspaceTaskDraft({ ...externalDraft(), priceUsd: "0", operatorRewardUsd: "0", inviteEmails: "" }, now);
    expect(result.errors).toEqual({});
    expect(result.input?.inviteEmails).toEqual([]);
  });

  it("rejects a scope wider than the server's 20-path cap", () => {
    const result = validateWorkspaceTaskDraft({ ...externalDraft(), scopePaths: Array.from({ length: 21 }, (_, index) => `src/Contract${index}.sol`).join("\n") }, now);
    expect(result.errors.scopePaths).toBeTruthy();
  });
});

describe("workspace account field validation", () => {
  it("requires the server's 12-character minimum only for new passwords", () => {
    expect(validateWorkspaceCredentials({ name: "A", email: "person@example.com", password: "x".repeat(11) }, true).password).toBeTruthy();
    expect(validateWorkspaceCredentials({ name: "A", email: "person@example.com", password: "x".repeat(12) }, true)).toEqual({});
    expect(validateWorkspaceCredentials({ name: "", email: "person@example.com", password: "x" }, false)).toEqual({});
  });
  it("shows missing names, invalid emails and empty passwords as field errors", () => {
    expect(validateWorkspaceCredentials({ name: " ", email: "invalid", password: "" }, true)).toMatchObject({ name: expect.any(String), email: expect.any(String), password: expect.any(String) });
  });
  it("matches bounded password byte and character limits", () => {
    expect(validateWorkspaceCredentials({ name: "Person", email: "person@example.com", password: "x".repeat(257) }, true).password).toBeTruthy();
    expect(validateWorkspaceCredentials({ name: "Person", email: "person@example.com", password: "€".repeat(200) }, true).password).toBeTruthy();
  });
});

describe("truthful workspace task summaries and filters", () => {
  const task = (id: string, ownerId: string, status: PilotTask["status"], title: string) => ({
    id, ownerId, status, title, description: "Solidity benchmark", target: "src/Batch.sol", ownerName: "Sponsor",
  }) as PilotTask;
  const tasks = [
    task("a", "me", "draft", "Batch brief"), task("b", "me", "review", "Gas review"),
    task("c", "other", "open", "Invited batch"), task("d", "me", "accepted", "Complete"),
    task("e", "other", "archived", "Archived"),
  ];

  it("counts only real accessible records and scopes sponsor review counts", () => {
    expect(workspaceTaskSummary(tasks, "me")).toEqual({ total: 5, owned: 3, invited: 2, active: 2, needsReview: 1, accepted: 1, drafts: 1 });
    expect(workspaceTaskSummary([], "me")).toEqual({ total: 0, owned: 0, invited: 0, active: 0, needsReview: 0, accepted: 0, drafts: 0 });
  });

  it("combines search, ownership and status without mutating the source", () => {
    expect(filterWorkspaceTasks(tasks, "me", { ownership: "invited", status: "open", search: " BATCH " }).map(item => item.id)).toEqual(["c"]);
    expect(filterWorkspaceTasks(tasks, "me", { ownership: "owned", status: "all", search: "gas" }).map(item => item.id)).toEqual(["b"]);
    expect(filterWorkspaceTasks(tasks, "me", { ownership: "all", status: "draft", search: "" }).map(item => item.id)).toEqual(["a"]);
    expect(tasks).toHaveLength(5);
  });
});
