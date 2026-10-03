import { describe, expect, it } from "vitest";
import { calculatePilotLedger } from "../../lib/pilot-ledger";
import type { PilotLedger } from "../../lib/pilot-types";

const ledger: PilotLedger = {
  serviceRevenueUsd: 300,
  operatorPaidUsd: 100,
  computeUsd: 20,
  supportUsd: 10,
  paymentFeesUsd: 5,
  platformMinutes: 90,
  platformHourlyUsd: 40,
  operatorComputeUsd: 15,
  operatorMinutes: 120,
  operatorHourlyUsd: 30,
  baselineMinutes: 240,
  setupMinutes: 20,
  reviewMinutes: 30,
  reworkMinutes: 10,
  paymentStatus: "unpaid",
  paymentReference: "",
};

describe("recorded pilot ledger economics", () => {
  it("subtracts setup, review and rework from the buyer baseline", () => {
    expect(calculatePilotLedger(ledger)).toMatchObject({ buyerMinutes: 60, buyerNetMinutes: 180 });
  });

  it("reports no buyer time saving when the baseline has not been recorded", () => {
    expect(calculatePilotLedger({ ...ledger, baselineMinutes: 0 }).buyerNetMinutes).toBeNull();
  });

  it("preserves additional buyer effort as a negative result", () => {
    expect(calculatePilotLedger({ ...ledger, baselineMinutes: 40 }).buyerNetMinutes).toBe(-20);
  });

  it("separates platform cash costs from platform labor", () => {
    expect(calculatePilotLedger(ledger)).toMatchObject({
      platformCashUsd: 265,
      platformLaborUsd: 60,
      platformContributionUsd: 205,
    });
  });

  it("does not double count the operator's separately recorded compute as a platform cost", () => {
    expect(calculatePilotLedger({ ...ledger, operatorComputeUsd: 80 }).platformCashUsd).toBe(265);
  });

  it("excludes operator-reward pass-through from platform service revenue and expenses", () => {
    expect(calculatePilotLedger({ ...ledger, operatorPaidUsd: 200 }).platformCashUsd).toBe(265);
  });

  it("subtracts compute and all recorded operator effort from recorded compensation", () => {
    expect(calculatePilotLedger(ledger)).toMatchObject({
      operatorCashUsd: 85,
      operatorLaborUsd: 60,
      operatorContributionUsd: 25,
    });
  });

  it("does not treat an absent hourly rate as free labor", () => {
    expect(calculatePilotLedger({ ...ledger, platformHourlyUsd: 0, operatorHourlyUsd: 0 })).toMatchObject({
      platformCashUsd: 265,
      platformLaborUsd: null,
      platformContributionUsd: null,
      operatorCashUsd: 85,
      operatorLaborUsd: null,
      operatorContributionUsd: null,
    });
  });

  it("keeps missing rate totals unknown even before any labor minutes are entered", () => {
    expect(calculatePilotLedger({
      ...ledger, platformHourlyUsd: 0, platformMinutes: 0, operatorHourlyUsd: 0, operatorMinutes: 0,
    })).toMatchObject({ platformContributionUsd: null, operatorContributionUsd: null });
  });

  it("preserves cash losses and fractional-hour effort", () => {
    expect(calculatePilotLedger({ ...ledger, serviceRevenueUsd: 0, platformMinutes: 15 })).toMatchObject({
      platformCashUsd: -35,
      platformLaborUsd: 10,
      platformContributionUsd: -45,
    });
  });

  it("does not infer transfers from a payment status or alter the source ledger", () => {
    const before = { ...ledger };
    expect(calculatePilotLedger({ ...ledger, paymentStatus: "paid", paymentReference: "Invoice 12" }))
      .toEqual(calculatePilotLedger(ledger));
    expect(ledger).toEqual(before);
  });
});
