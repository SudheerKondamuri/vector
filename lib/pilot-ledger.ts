import type { PilotLedger } from "./pilot-types";

/** Arithmetic over recorded entries; unknown baselines/rates do not become savings. */
export function calculatePilotLedger(ledger: PilotLedger) {
  const buyerMinutes = ledger.setupMinutes + ledger.reviewMinutes + ledger.reworkMinutes;
  const buyerNetMinutes = ledger.baselineMinutes > 0 ? ledger.baselineMinutes - buyerMinutes : null;
  // Service/fee revenue excludes the operator-reward pass-through. Record a
  // platform-funded reward/subsidy under platform support costs, not twice.
  const platformCashUsd = ledger.serviceRevenueUsd - ledger.computeUsd - ledger.supportUsd - ledger.paymentFeesUsd;
  const platformLaborUsd = ledger.platformHourlyUsd > 0
    ? ledger.platformMinutes / 60 * ledger.platformHourlyUsd : null;
  const operatorCashUsd = ledger.operatorPaidUsd - ledger.operatorComputeUsd;
  const operatorLaborUsd = ledger.operatorHourlyUsd > 0
    ? ledger.operatorMinutes / 60 * ledger.operatorHourlyUsd : null;

  return {
    buyerMinutes,
    buyerNetMinutes,
    platformCashUsd,
    platformLaborUsd,
    platformContributionUsd: platformLaborUsd === null ? null : platformCashUsd - platformLaborUsd,
    operatorCashUsd,
    operatorLaborUsd,
    operatorContributionUsd: operatorLaborUsd === null ? null : operatorCashUsd - operatorLaborUsd,
  };
}
