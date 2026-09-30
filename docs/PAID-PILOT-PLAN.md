# Paid gas-optimization pilot

**Revision:** 1 — 2026-10-04  
**Status:** Active planning scope; no demand, revenue, or test results established yet  
**Parent:** [PRODUCT-DESIGN-PLAN.md](PRODUCT-DESIGN-PLAN.md), revision 2

## 1. Experiment and offer

Hypothesis: protocol engineering teams with existing Foundry suites will repeatedly pay for a bounded Solidity gas-optimization patch because independently reproduced evidence reduces their total delivery effort compared with using their own AI coding tools.

Offer: **share a repository commit, target component, and constraints; receive a Git patch, reproducible gas benchmarks, a check report, and a sponsor review decision.**

This experiment does not require a public marketplace, credit system, token, full SDK, generic adapter editor, or escrow. Keep the broad product architecture as a future direction; use a versioned task manifest without implementing its entire ecosystem.

## 2. Who to recruit

- Buyer: protocol engineering lead with budget authority or access to the budget owner.
- Problem: a bounded gas-cost issue with a realistic usage pattern and existing tests.
- Repository: public/sanitized preferred; a pinned commit and dependencies with reproducible Foundry commands.
- Supply: invited independent agent operators who run reasoning and tools themselves.
- Founder-controlled agent configurations: useful feasibility experiments, not evidence of independent supply.

Record the last similar task, why it matters now, task frequency, current tools, budget process, and why internal AI-assisted engineering was insufficient. Decline open-ended tasks, inadequate baselines, undocumented private access, or requests to change live contracts.

## 3. Assisted intake and task agreement

The buyer initially provides only repository/commit, target function(s), and constraints. The founder assists with a one-page scope that the buyer and operator accept before execution:

| Field | Agreement required |
|---|---|
| Inputs | Commit, paths in scope, dependency versions, authorized access |
| Artifact | Git patch against that commit; no modifications to verifier/tests/benchmarks |
| Behavior | ABI, storage layout, events, reverts, access controls, arithmetic behavior and other task-specific constraints |
| Benchmark | Workloads, weights, compiler/optimizer/EVM settings, gas metric and minimum improvement |
| Checks | Fixed tests plus agreed fuzz/invariants; seeds, run limits, logs and replay command |
| Ranking | Hard gates before score; tie handling and finalist policy if multiple operators participate |
| Review | Named reviewer, objective and subjective criteria, response deadline and escalation |
| Money | Total service price, operator compensation, payment milestones, failed-task and rework rules |
| Rights | Evaluation/usage license, ownership transfer, confidentiality, retention and permitted disclosure |
| Limits | Deadline, invited slots, attempts per operator, runtime and total spend cap |

Numeric thresholds, prices, deadlines, payment rails, and legal terms remain per-task decisions. No operator starts paid work without these fields agreed. Choose an existing lawful invoice/payment process; writing this plan does not authorize any transfer or custody.

Freeze benchmark weights and environment before submissions. Reject patch edits to tests, verifier scripts, benchmark config, or out-of-scope paths. Sponsor-requested changes create a new scope/version, not retroactive rejection criteria.

## 4. Controlled delivery loop

1. Reproduce the original build/tests/benchmark. If the baseline fails, resolve it before optimization.
2. Agree price, acceptance, access, compensation and attempt limits.
3. Give invited operators identical scoped bundles; keep competitors' patches private during work.
4. Operators run models/tools externally and submit a patch, base commit, artifact hash, and method summary.
5. Validate size/path/hash, apply to a clean fixture, and run bounded verification on a dedicated worker.
6. Compare baseline and patch with identical settings and workloads. Report per-workload regressions as well as aggregate improvement.
7. Replay eligible results in a clean environment with pinned dependencies and seeds; document any nondeterminism.
8. Deliver the patch, benchmark table, test/fuzz/invariant results, logs, limitations, resource usage and replay instructions.
9. Buyer accepts/rejects against agreed criteria; record review and rework effort and complete payment as agreed.
10. Ask for the next paid task and invite operators back after showing their attempt costs/results.

Passing tests means tested constraints passed in that environment. It does not establish complete equivalence, an independent security audit, or safety to merge into production.

## 5. Baseline and three-sided economics

Compare against the buyer's existing **internal AI-assisted workflow**, not a hypothetical expensive consultant. Ideally measure a comparable recent task or prospectively time a scoped internal attempt. Label retrospective estimates, task mismatches, unknowns, and confidence; do not invent dollar savings from assumed hourly rates.

For every task collect:

- Buyer baseline tool spend, specification/setup minutes, coding minutes, review minutes, rework minutes, elapsed time and accepted outcome.
- Pilot buyer price, setup/review/rework minutes, elapsed time, acceptance, merge decision, and payment status.
- Platform compute/storage, retries/failures, support, acquisition, review/dispute time, payment costs and delivery labor.
- Operator identity, model/tool configuration, all attempts, model spend, human/tool time, compensation, and whether they return.

Report separately:

1. **Buyer value:** net time saved = baseline total buyer effort − pilot total buyer effort. Compare total price plus buyer-supplied labor valuation and tool spend; distinguish time released from actual cash saved.
2. **Platform contribution:** earned service/fee revenue − all delivery costs. Show cash contribution and labor-inclusive contribution; do not count reward pass-through as platform revenue. Identify subsidies and acquisition costs.
3. **Operator economics:** received compensation − compute and human-effort cost across winning and losing attempts. Expected future return is a hypothesis until outcomes and return behavior are observed.

A service sale does not validate a 5% commission marketplace. If competitive supply is uneconomic but buyers value the evidence, test paid commissioned delivery or a verification service.

## 6. Budget boundary

The agreed validation constraint is **under $500**. Do not treat this as a plausible complete production-development budget.

Proposed allocation, requiring confirmation before paid execution: cap founder-funded compute/storage/tools at $300, participant compensation/subsidy at $150, and contingency at $49 (maximum $499). These are ceilings, not vendor quotes. Obtain approval before paid calls or provisioning; halt at caps rather than silently increase spending.

- Include founder-funded participant rewards and model calls in the cash cap; do not count them twice.
- Sponsor-funded compensation is tracked separately as a task budget/pass-through, not hidden platform funding or revenue.
- Founder labor is excluded from the cash cap but recorded in hours and valued separately for economics.
- If $499 cannot recruit or compensate meaningful independent participation, report supply as unvalidated and request a budget decision; do not relabel founder runs as operators.
- Sponsor payments are real transactions through the agreed process. Test assets and discounted/grant-funded experiments do not establish unsubsidized willingness to pay.

**Next approval needed:** confirm allocation/exclusions, task price, compensation, payment/use terms, and safe worker environment before spending or accepting paid work.

## 7. Trust and safe execution

- Public/sanitized code by default. Private code shared with an external operator can be copied; consent and confidentiality agreements reduce risk but cannot technically guarantee secrecy or remote deletion.
- Sponsor approval does not resolve nonpayment fairly by itself. Pre-agree evaluation/use rights, payment milestones, rejection reasons, a review deadline, and a named escalation route. Reruns resolve check disputes, not every subjective or commercial disagreement.
- Treat patches, repository scripts, compilers, tests, and dependencies as untrusted execution.
- Use a dedicated disposable worker with non-root execution, fixed CPU/memory/disk/time caps, no secrets or production access, no Docker socket/host mounts, and no unrestricted network. Prepare pinned images/dependencies separately; verify offline where possible.
- Container controls must be tested; Docker alone is not a claim of hostile-code isolation. No arbitrary public intake until threat review and escape/resource-abuse testing are complete.
- Do not include private source, identifying customer data, credentials, or private logs in public evidence. Keep authorized raw records private; share only agreed redacted summaries.
- No autonomous production merges, deployments, transactions, escrow custody, or mainnet payouts are included.

## 8. Proposed cadence and decision gates

Cadence is a working sequence, not a promise of customer acquisition or a fixed delivery date:

1. Discovery: interview 10–15 same-cohort leads and qualify three real tasks.
2. Feasibility: reproduce one public/sanitized baseline and complete a controlled patch/replay experiment.
3. Paid delivery: deliver tasks to unrelated buyers and recruit invited independent operators.
4. Follow-up: measure actual payments, repeat purchases, operator return and all three economics.

Review after the first three qualified tasks and again after the repeat-task follow-up. Unknown evidence keeps the gate open; it is not a pass.

| Gate | Proposed pass evidence | Status |
|---|---|---|
| Task demand | Three unrelated teams provide real tasks in the same gas-optimization category | Not measured |
| Paid demand | At least two distinct teams pay for delivered work; report discounts/subsidies | Not measured |
| Recurrence | At least one buyer purchases a second task | Not measured |
| Buyer advantage | Paid buyers demonstrate net time saved after setup, review and rework, against a documented internal AI-assisted baseline | Not measured |
| Independent supply | At least two independent operators return for another task after results and all-attempt cost disclosure | Not measured |
| Economic feasibility | Separate buyer-value, labor-inclusive platform contribution, and operator-return results support repeat delivery without unexplained subsidy | Not measured |

These are founder decision gates, not market benchmarks. Do not infer sustainable win rates from a tiny sample. Paid repeat demand is stronger than interest, but not proof of scale.

**Continue:** gates support productizing assisted delivery, with explicit review of the measurements before broader engineering.

**Hold:** repeat demand or independent supply is unmeasured; continue bounded experiments, not infrastructure expansion.

**Pivot:** sponsors pay for verification but not competitions; pursue a verification/evidence service or commissioned engineering workflow.

**Stop:** no paid interest, no net buyer advantage, or economics remain negative without a credible measured improvement.

## 9. Active acceptance brief

All criteria are pending. Documentation is not evidence that the checks have passed.

| ID | Scenario and trigger | Expected observable result | Prohibited outcome | Verification method |
|---|---|---|---|---|
| P-001 | Qualified buyer submits repo/target/constraints; intake is completed | Signed-off scope records price, baseline, checks, limits, subjective review, payment/use/access terms | Work starts with unresolved compensation or acceptance rules | Manual scope checklist; stakeholder sign-off |
| P-002 | Agreed task enters execution; baseline is run | Pinned commit/tool versions produce recorded tests and benchmark outputs | Optimize an unreproducible baseline or edit benchmark rules mid-task | Clean-worker baseline run; manifest/hash inspection |
| P-003 | Operator submits a patch; intake checks run | Base hash, artifact hash, size and allowed paths are recorded; invalid patches rejected | Agent modifies tests/verifiers or receives another operator's submission without permission | Patch-validation tests and controlled-channel access check |
| P-004 | Accepted patch enters verification; limits apply | Bounded dedicated-worker run records exit status, logs, checks and usage; quota overrun terminates and is reported | Host/secret access, unrestricted network or unrecorded extra spend | Resource-limit/network-access tests and worker configuration review |
| P-005 | Result reaches buyer review; evidence is delivered | Patch, per-workload gas comparison, passed/failed checks, limitations and replay instructions are visible | Claim complete equivalence or security from test passes | Clean independent replay; buyer evidence checklist |
| P-006 | Buyer accepts/rejects; agreed review process runs | Decision/reason, review time, payment status and any escalation are recorded | Treat testnet money as a sale or infer approval from silence without agreed terms | Decision/payment records review in private authorized records |
| P-007 | Task and follow-up close; economics are analyzed | Separate buyer/platform/operator costs, failed attempts, subsidies and actual repeat behavior are reported | Count founder model runs as independent supply or hide labor | Cost ledger reconciliation and gate review |

All P-001 through P-007 are required. Tests run only on authorized pilot fixtures and dedicated environments; no live-fund, production or destructive security operations are authorized by this plan.

## 10. Evidence package and immediate next action

Per task, retain a versioned scope manifest, original and patched hashes, benchmark/check outputs, replay manifest, redacted evidence report, buyer decision, private payment record, and three-sided cost worksheet. Public summaries contain no private customer code or raw private notes.

Immediate next action: recruit the first protocol engineering lead with a real gas-cost problem, obtain a public/sanitized task and baseline, and agree the bounded pilot scope. Do not begin marketplace contracts, credits, a full SDK, or extra adapters until the gates justify them.
