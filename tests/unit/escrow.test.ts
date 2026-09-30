import { describe, expect, it } from "vitest";
import { createEscrow, transitionEscrow, validateDraft, getTotals, restoreState, createInitialState, DEMO_BALANCE, type EscrowStatus } from "../../lib/escrow";

const draft = { title: "Analyze a protocol", description: "Research governance and provide a written report.", agentId: "atlas", amount: "500", deadline: "7" };

describe("escrow creation", () => {
  it("creates a draft with three incomplete milestones", () => {
    const escrow = createEscrow(draft, "test-id");
    expect(escrow).toMatchObject({ id: "test-id", title: draft.title, amount: 500, status: "draft" });
    expect(escrow.milestones.filter(m => m.complete)).toHaveLength(0);
    expect(escrow.milestones).toHaveLength(3);
  });
  it.each([
    { title: " " }, { title: "x".repeat(101) }, { description: "short" },
    { amount: "0" }, { amount: "-20" }, { amount: "10001" }, { amount: "NaN" },
    { amount: "1.111" }, { amount: "Infinity" }, { agentId: "missing" },
    { deadline: "0" }, { deadline: "31" }, { deadline: "1.5" }
  ])("rejects invalid task data %o", (override) => {
    expect(Object.keys(validateDraft({ ...draft, ...override })).length).toBeGreaterThan(0);
    expect(() => createEscrow({ ...draft, ...override }, "bad")).toThrow();
  });
  it("allows the budget bounds", () => {
    expect(validateDraft({ ...draft, amount: "1" })).toEqual({});
    expect(validateDraft({ ...draft, amount: "10000" })).toEqual({});
  });
});

describe("escrow lifecycle", () => {
  it("funds, runs, reviews and settles only after all milestones complete", () => {
    let escrow = createEscrow(draft, "flow");
    escrow = transitionEscrow(escrow, "fund", true, DEMO_BALANCE);
    expect(escrow.status).toBe("funded");
    escrow = transitionEscrow(escrow, "start", true, DEMO_BALANCE);
    expect(escrow.status).toBe("running");
    escrow = transitionEscrow(escrow, "advance", true, DEMO_BALANCE);
    expect(escrow.status).toBe("running");
    escrow = transitionEscrow(escrow, "advance", true, DEMO_BALANCE);
    escrow = transitionEscrow(escrow, "advance", true, DEMO_BALANCE);
    expect(escrow.status).toBe("review");
    expect(escrow.milestones.every(m => m.complete)).toBe(true);
    escrow = transitionEscrow(escrow, "release", true, DEMO_BALANCE);
    expect(escrow.status).toBe("released");
    expect(() => transitionEscrow(escrow, "release", true, DEMO_BALANCE)).toThrow();
  });
  it("requires a wallet to fund and settle", () => {
    const escrow = createEscrow(draft, "wallet");
    expect(() => transitionEscrow(escrow, "fund", false, DEMO_BALANCE)).toThrow(/wallet/i);
    expect(() => transitionEscrow({ ...escrow, status: "review" }, "release", false, DEMO_BALANCE)).toThrow(/wallet/i);
  });
  it("rejects funding above available balance", () => {
    expect(() => transitionEscrow(createEscrow(draft, "funds"), "fund", true, 100)).toThrow(/balance/i);
  });
  it("cannot release work before review", () => {
    expect(() => transitionEscrow(createEscrow(draft, "early"), "release", true, DEMO_BALANCE)).toThrow();
  });
  it("cannot approve a review with incomplete milestones", () => {
    expect(() => transitionEscrow({ ...createEscrow(draft, "incomplete"), status: "review" }, "release", true, DEMO_BALANCE)).toThrow(/milestone/i);
  });
  it.each(["funded", "running", "review"] as EscrowStatus[])("disputes and refunds a %s escrow", (status) => {
    const escrow = { ...createEscrow(draft, "dispute"), status };
    const disputed = transitionEscrow(escrow, "dispute", true, DEMO_BALANCE);
    expect(disputed.status).toBe("disputed");
    expect(transitionEscrow(disputed, "refund", true, DEMO_BALANCE).status).toBe("refunded");
  });
  it("does not mutate the original escrow", () => {
    const original = { ...createEscrow(draft, "immutable"), status: "running" as const };
    transitionEscrow(original, "advance", true, DEMO_BALANCE);
    expect(original.milestones[0].complete).toBe(false);
  });
});

describe("dashboard totals and persistence", () => {
  it("keeps seeded locked and settled balances consistent", () => {
    expect(getTotals(createInitialState().escrows)).toMatchObject({ locked: 14000, settled: 10850, active: 4, total: 24850 });
  });
  it("excludes drafts and refunds from secured balances", () => {
    const base = createEscrow(draft, "exclude");
    expect(getTotals([base, { ...base, id: "r", status: "refunded" }])).toMatchObject({ locked: 0, settled: 0, total: 0, active: 1 });
  });
  it("restores valid demo data", () => {
    const state = createInitialState();
    state.walletConnected = true;
    expect(restoreState(JSON.stringify(state))).toEqual(state);
  });
  it.each([null, "broken", "{}", '{"version":99}', '{"version":1,"escrows":[null]}'])("recovers safely from invalid storage %s", (raw) => {
    expect(restoreState(raw).escrows).toHaveLength(6);
  });
  it("rejects malformed balances, milestones and unknown statuses", () => {
    const state = createInitialState();
    expect(restoreState(JSON.stringify({ ...state, balance: -1 })).balance).toBe(DEMO_BALANCE);
    expect(restoreState(JSON.stringify({ ...state, escrows: [{ ...state.escrows[0], milestones: "bad" }] })).escrows).toHaveLength(6);
    expect(restoreState(JSON.stringify({ ...state, escrows: [{ ...state.escrows[0], status: "unknown" }] })).escrows).toHaveLength(6);
  });
});
