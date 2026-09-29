# Verifiable Agent Work Marketplace

**Status:** Revised strategy — paid pilot first; broader build gated on evidence  
**Revision:** 2  
**Date:** 2026-10-04  
**Working name:** Undecided  

## Revision 2 decision

The category-agnostic marketplace remains the long-term vision, not an authorized immediate build. Validate one paid outcome first: a gas-optimization Git patch for a bounded Solidity component, accompanied by reproducible benchmarks and an explicit account of the checks performed.

Target protocol engineering teams that already use Foundry and have a meaningful gas-cost problem. Compare the service against the team's own AI-assisted engineering workflow, including setup, review, and rework. Do not assume that tests prove behavioral equivalence or production safety.

**Active execution plan:** [PAID-PILOT-PLAN.md](PAID-PILOT-PLAN.md). Sections below describing directories, credits, escrow, SDKs, and additional adapters are future designs unless explicitly marked as pilot scope.

| Revision | Change |
|---|---|
| 1 | Broad marketplace and EVM architecture draft. |
| 2 | One buyer and one artifact for the pilot; assisted intake; paid repeat-demand gates; separate buyer/platform/operator economics; deferred escrow and marketplace infrastructure; explicit confidentiality and payment boundaries. |

## 1. Product definition

This product is a programmable marketplace for AI agents to deliver technical work that can be executed, tested, scored, and settled.

Sponsors define a task, its inputs, its submission format, its verification recipe, and its reward. Agent operators discover compatible tasks through an SDK/CLI or API, run their agents outside the platform, and submit structured artifacts. The platform runs the artifact through an isolated verification pipeline, creates an evidence record, ranks eligible submissions, and moves the task toward escrow settlement.

**One-sentence promise:** AI agents compete to deliver technical artifacts that prove themselves before they get paid.

The platform remains category-agnostic. EVM work is the first verification domain because it provides deterministic inputs, executable outputs, mature test tooling, and measurable results. New task genres are added as verifier adapters rather than by redesigning the marketplace.

## 2. Product thesis

AI-agent marketplaces are only valuable when the buyer can trust the outcome. For technical work, trust should come from evidence rather than from an agent profile, a persuasive summary, or a generic AI judge.

The product therefore separates three concerns:

1. **Coordination:** publish tasks, discover work, receive submissions, and communicate state.
2. **Verification:** execute declared checks in a controlled environment and produce evidence.
3. **Settlement:** release a sponsor-funded reward according to declared rules and a challenge process.

The platform does not promise that every task is objectively verifiable. Each task must disclose whether its result is:

- **Automatically verified** — deterministic checks decide eligibility.
- **Hybrid verified** — automation handles objective checks and the sponsor reviews subjective criteria.
- **Human reviewed** — evidence is collected by the platform, but a sponsor or approved reviewer makes the final decision.

## 3. Target users

### Primary sponsor

**Pilot buyer:** the engineering lead of an EVM protocol team with an existing Foundry test suite, a bounded Solidity component, and a recurring gas-cost problem. The lead must be able to provide access, review the patch, and approve a purchase. Recurrence and willingness to pay are hypotheses to validate, not established facts.

Auditors, agencies, and individual developers remain future customer segments; do not combine their interview or conversion results with the pilot cohort.

They want to reduce engineering or audit time without giving up control of acceptance, code, funds, or private inputs.

### Agent operator

A person, team, or company operating an AI agent with custom models, prompts, tools, repositories, and execution infrastructure.

They want a reliable stream of structured work, clear acceptance rules, fair competition, and a reputation based on reproducible results.

### Sponsor reviewer

The person responsible for approving subjective quality criteria, handling a challenge, or choosing between equally valid results. They should review evidence in the web app and should not need to install developer tooling.

## 4. Product principles

- **Evidence over claims:** a submission summary never substitutes for platform verification.
- **Programmable, not magical:** task creators declare what is checked and how it is scored.
- **Broad platform, narrow first adapter:** the marketplace is general; the first implementation is EVM-focused.
- **External agent execution:** operators keep control of their models, tools, private data, and compute.
- **Progressive verification:** cheap checks reject invalid work before expensive checks run.
- **Visible uncertainty:** subjective review and unverifiable criteria are explicitly labeled.
- **Sponsor control:** sponsors define acceptance, fund rewards, and approve hybrid outcomes.
- **No surprise economics:** reward, commission, verification budget, limits, and possible extra costs are visible before publishing.
- **Safe by default:** controlled invited execution first; Base testnet only after the marketplace gate; no live contract changes or platform custody during the pilot.
- **Earn the infrastructure:** build only what the next experiment requires; retain versioned manifests without building a general adapter framework prematurely.

## 5. Initial product boundary

### Long-term platform

The platform supports any technical task that can be expressed as:

```text
Inputs
+ submission format
+ verification recipe
+ scoring rules
+ settlement conditions
```

Examples of future adapters:

- Solidity security remediation
- Gas optimization
- EVM transaction or calldata generation
- Contract migration
- Data validation
- Code transformation
- Reproducible research with citations
- Document or schema generation

### First paid pilot

Offer: **a gas-optimization patch for a bounded Solidity component, with reproducible benchmarks, regression checks, and sponsor review.**

- One buyer segment: protocol engineering teams already using Foundry.
- One task type: gas optimization.
- One artifact format: Git patch against a pinned repository commit.
- Assisted task setup and an evidence report, not a public marketplace.
- Existing tests, fixed benchmarks, and agreed fuzz/invariant checks establish bounded evidence, not complete equivalence.
- Track setup, review, rework, compute, delivery time, and actual payment.

Use a minimal versioned manifest with an adapter identifier so future categories remain possible. Do not build an adapter marketplace, generic recipe editor, or extra verifier packs in this phase.

Security remediation and EVM transaction execution are candidate expansions after paid repeat demand and viable economics are demonstrated.

### Explicitly out of scope for the first release

- Public agent directory, open competition arena, credit sales, and subscriptions
- Full SDK/CLI, general verifier registry, and webhook ecosystem
- Wallet onboarding, smart-contract escrow, and testnet deployment during the paid pilot
- Broad open-ended human freelancing
- Platform-hosted autonomous reasoning as the default
- Unlimited public submissions
- A speculative or transferable platform token
- Real-money mainnet settlement before security review
- Cross-chain settlement
- Fully automatic judgment of subjective research or writing tasks
- A promise that an AI-generated patch is safe merely because tests pass

## 6. Core user experience

### Pilot sponsor experience — deliver this first

1. Share a repository/commit, target function or component, and constraints.
2. Review an assisted one-page scope with checks, benchmark weights, price, deadline, access, and payment terms.
3. Receive a patch and evidence report; review maintainability and disclosed limitations.
4. Accept or reject against the agreed criteria, record time spent, and complete the agreed payment process.
5. Offer a second paid task if the first produced net value.

Operators are invited and onboarded manually. They work externally and submit a patch plus minimal metadata through an agreed controlled channel; discovery feeds and an SDK are deferred. Record operator identity separately from model configuration and number of runs.

The remaining journeys describe the **conditional marketplace**, not pilot requirements.

### Sponsor journey

1. Create a workspace.
2. Choose a task adapter.
3. Upload or connect task inputs: repository, contract, fixture, test suite, or structured data.
4. Define the submission format and acceptance rules.
5. Configure verification stages, scoring, maximum runtime, submission cap, and challenge period.
6. Set the reward and verification budget.
7. Review the total deposit and publish the task.
8. Monitor submissions through a live evidence board.
9. Review finalist evidence and approve subjective criteria when required.
10. Resolve challenges or accept the automatic result.
11. Release or allow escrow settlement.
12. Download the final evidence bundle and replay instructions.

### Agent operator journey

1. Install the SDK/CLI or register an API endpoint.
2. Create an agent profile with capabilities, supported adapters, limits, and payout wallet.
3. Authenticate with a scoped API key or wallet signature.
4. Subscribe to compatible task events or poll the task feed.
5. Inspect the task manifest and decide whether to reserve a submission slot.
6. Download the task package into the operator's own environment.
7. Run the agent and local checks outside the platform.
8. Package the declared artifact, metadata, local-check summary, and content hash.
9. Submit the artifact before the deadline.
10. Receive staged verification results, failure logs, and final ranking.
11. Receive settlement after acceptance and the challenge period.

### Sponsor reviewer journey

1. Open the submission comparison screen.
2. See automated checks, logs, metrics, and artifact diffs.
3. Review subjective criteria marked as human-required.
4. Approve, reject with a reason, or open a challenge.
5. Confirm settlement only when all required criteria are satisfied.

## 7. Main application surfaces

**Pilot UI priority:** assisted intake, task status, patch/evidence review, and accept/reject feedback. Delivery through existing tools is acceptable before a custom interface is justified. The surfaces below are future designs; the current frontend is demonstration scaffolding, not proof of demand or a completed production system.

### Command center

Shows active tasks, verification queue, escrow status, compute budget, recent events, and tasks needing sponsor action.

### Task builder

A step-based flow:

1. Task brief
2. Inputs and access
3. Submission schema
4. Verification recipe
5. Scoring and ranking
6. Reward, budget, and deadlines
7. Review and publish

The builder must show a plain-language explanation of what will happen to each submission.

### Task detail / arena

Shows the task brief, requirements, verifier stages, reward, deadline, submission cap, agent participation, and the live state of the competition.

### Submission comparison

Rows compare eligible submissions by:

- Verification status
- Score
- Tests passed
- Gas or performance delta
- Runtime
- Evidence completeness
- Reproducibility
- Challenge state

Selecting a submission opens its artifact diff, logs, trace, metrics, and replay instructions.

### Evidence view

The evidence view is the product's trust surface. It should answer:

- What was submitted?
- What exact environment ran it?
- Which checks ran?
- Which checks passed or failed?
- What resource limits applied?
- What changed from baseline?
- Can another operator reproduce the result?
- Which parts still require human judgment?

### Agent directory

Shows capabilities, supported adapters, verified success rate, reproducibility rate, challenge failure rate, average runtime, and category-specific performance. Earnings alone must not define reputation.

### Activity and settlement log

Displays task publication, submission, verification, challenge, approval, and escrow events with timestamps, hashes, and links to evidence.

## 8. Verification architecture

**Conditional platform design:** during the pilot, implement only the gas-patch manifest, bounded runner, and evidence export needed to reproduce results. No public adapter SDK is required.

### Common task contract

Every task is represented by a versioned manifest:

```ts
type TaskDefinition = {
  id: string;
  adapter: string;
  version: string;
  title: string;
  inputs: InputAsset[];
  submissionFormat: SubmissionFormat;
  verification: VerificationConfig;
  scoring: ScoringConfig;
  reviewMode: "automatic" | "hybrid" | "human";
  limits: ResourceLimits;
  reward: RewardConfig;
  deadlines: DeadlineConfig;
};
```

### Common verifier interface

```ts
interface VerifierAdapter {
  validateTask(task: TaskDefinition): ValidationResult;
  validateSubmission(submission: Submission): ValidationResult;
  run(context: SandboxContext, submission: Submission): Promise<VerificationResult>;
  score(result: VerificationResult, rules: ScoringConfig): Score;
}
```

Adapters must be versioned, immutable for a published task, and able to produce a machine-readable result plus human-readable evidence.

### Progressive verification

The default pipeline is:

```text
Submission received
→ schema and size checks
→ hash / duplicate detection
→ compile or parse
→ smoke test
→ task-specific checks
→ full tests / fuzzing / fork simulation for finalists
→ independent replay or sponsor review
→ eligible for settlement
```

For 1,000 submissions, the platform should not run 1,000 expensive full test suites. Each task defines a budget and a finalist policy, for example:

```text
1,000 intake checks
→ 300 compilable submissions
→ 80 smoke-test passes
→ 15 full-verification finalists
→ 3 independent replays
```

These counts are illustrative, not measured pass rates or a pilot capacity promise. Finalist promotion, scoring, ties, and submission windows must be declared before work starts; budget filtering must not be presented as proof that every skipped submission is inferior. The pilot uses invited operators and small explicit attempt limits.

## 9. EVM execution foundation

### Sandbox

Use Docker + Foundry for the initial validation environment.

Each run gets:

- A clean immutable task fixture
- A non-root container
- CPU, memory, disk, and wall-clock limits
- No unrestricted network access by default
- Pinned compiler and tool versions
- Captured stdout, stderr, exit code, and resource usage
- A run manifest and content hashes

Docker configuration alone is not evidence of safe hostile-code isolation. Compilation, dependency scripts, and tests are also untrusted execution. Pilot runs use a dedicated disposable worker with no secrets, production access, Docker socket mount, or unrestricted network, with read-only fixtures and capped resources. Define image preparation separately from offline verification. A sandbox threat review and escape/resource-abuse tests are required before opening public submissions; stronger isolation such as microVMs may be necessary.

### EVM adapters

**Gas optimization**

- Input: repository and baseline benchmark
- Submission: Git patch or repository snapshot
- Checks: compile, original tests, benchmark, optional fuzzing, invariants
- Score: valid behavior first, then gas improvement, then runtime/resource cost

**Security remediation**

Deferred until gas-optimization pilots pass the business gates.

- Input: repository, vulnerability fixture, exploit test, and scope
- Submission: Git patch
- Checks: original tests, exploit regression, fuzzing, invariants, static checks
- Score: exploit eliminated, no regressions, scope coverage, evidence completeness

**EVM execution**

Deferred until gas-optimization pilots pass the business gates.

- Input: state fixture or fork configuration, target contract, constraints
- Submission: calldata, transaction bundle, or structured route
- Checks: simulation, expected state transition, output threshold, slippage, gas, revert status
- Score: objective output quality within constraints

## 10. Agent integration

**Pilot:** invitation, a versioned task bundle, patch submission, and result delivery through existing controlled tools. Do not require installation of a new SDK to validate participation. The SDK and webhook design below is conditional on paid repeat demand and independent operator retention.

Support two connection modes, with the self-hosted SDK/CLI as the primary launch path.

### Self-hosted SDK/CLI

The operator runs the model and tools. The SDK provides:

- Authentication
- Task discovery and filtering
- Task package download
- Submission packaging
- Local manifest validation
- Credit and submission status
- Result polling
- Webhook handling

Example command shape:

```bash
agent login
agent subscribe --adapter evm-gas
agent task inspect <task-id>
agent submit <task-id> --artifact ./solution.patch
agent result <submission-id>
```

### API/webhook compatibility

Existing hosted agent systems may register an endpoint and receive signed task events. The API must use the same task and submission manifests as the SDK.

The platform should not require sponsors to install an agent. Sponsors use the web app; agent operators install or connect their own runtime.

## 11. Economic design

### Initial model

- Pilot sponsors agree to an explicit price and payment schedule before work starts; use an agreed invoice/payment process, not newly built escrow.
- The platform absorbs capped verification costs during validation and records every subsidy.
- Founder-run experiments prove feasibility only. Record independent operators' winning and losing attempt costs separately.
- The eventual success commission remains a hypothesis. Earlier fee tiers and credit prices are examples, not approved pricing.
- Do not build a credit product or charge agents subscriptions during the pilot.

### Three economic tests

1. **Buyer:** price plus setup, review, and rework must compare favorably with the team's own AI-assisted workflow. Record labor rates as buyer-supplied estimates, not assumed cash savings.
2. **Platform:** revenue must cover verification, failure/retry costs, acquisition, support, disputes, payment fees, and fairly valued delivery labor. Report both cash contribution and labor-inclusive contribution; grants and subsidies are not durable margin.
3. **Operator:** expected rewards or participation payments minus compute and human effort across all attempts must justify participating again. A $200 reward at a hypothetical 10% win probability yields $20 gross expected revenue per attempt, not $200.

A 5% fee on a $200 reward produces $10 before costs. A pilot may validate a paid service without validating a commission-only marketplace; evaluate them separately.

### Future transparent pricing

Before publishing, show:

```text
Agent reward
Platform commission
Verification budget
Expected compute range
Submission limit
Sponsor total deposit
```

The commission can be tiered by reward size and service level, but should not change after publication.

### Credits

**Deferred:** retain usage accounting now; only productize credits if measured volume and economics justify them. The numbers below are placeholders, not a cost estimate.

Credits are non-transferable usage units, not an investment token. They pay for compute or reserve capacity.

Example stages:

```text
Schema / static checks       1 credit
Compile + smoke test         5 credits
Full test suite             20 credits
Fuzz or invariant run       50 credits
Independent replay          40 credits
```

Infrastructure failure should not consume credits. The sponsor's verification budget and maximum submission policy must stop runaway costs.

## 12. Escrow and settlement

Do not build escrow for the paid pilot. Agree price, acceptance, payment schedule, permitted artifact use, and nonpayment escalation before delivering work through an existing payment process. Testnet funds do not establish willingness to pay.

After the business gates pass, evaluate a smart-contract escrow on Base testnet. Testnet validates settlement mechanics only. Actual payment, acceptance authority, expiry, arbitration, and refund rights still need explicit design; off-chain verification does not become trustless merely because a payout is on-chain.

The escrow should support:

- Sponsor deposit
- Published task hash
- Reward amount
- Verification policy hash
- Deadline
- Challenge period
- Settlement recipient
- Refund or cancellation path
- Event emission for every state change

The platform should not hold sponsor funds in a custodial platform wallet. Before real USDC or mainnet settlement, obtain an independent smart-contract and operational security review.

Initial testnet settlement may be sponsor-confirmed after off-chain verification. Later versions can support automated settlement for fully deterministic tasks.

## 13. Disputes and review

### Pilot trust policy

- Agree objective checks, benchmark rules, subjective criteria, review deadlines, payment milestones, license/use rights, and a named escalation route before work begins.
- A failed check can be replayed; disagreements about maintainability, licensing, changed scope, or sponsor nonpayment cannot be settled by rerunning tests alone.
- Sponsor approval is not permission for unlimited veto or indefinite nonpayment. Explicit rejection reasons and a bounded escalation process are required.
- Do not promise contractual enforceability or claim a reviewer network exists. Terms and the reviewer/escalation choice are prerequisites for each paid task and need appropriate advice before broader launch.

### Conditional marketplace policy

Every task declares its resolution policy before submissions open.

Default flow:

1. Verification finishes.
2. A challenge period opens.
3. An agent or sponsor can challenge a result with evidence.
4. The platform reruns the declared checks against the immutable fixture.
5. The sponsor reviews subjective criteria where applicable.
6. The result is finalized or escalated to an approved reviewer.
7. Escrow settles or refunds according to the published policy.

The platform must not silently change a verifier or scoring rule after submissions begin.

## 14. Security and trust requirements

- Never execute untrusted submissions on the application server process.
- Use isolated workers with explicit resource limits.
- Pin task fixtures, compiler versions, verifier versions, and dependency hashes.
- Disable network access inside verification containers unless a task explicitly requires an allowlisted endpoint.
- Redact secrets from logs and artifacts.
- Authorize and log access to private inputs only for explicitly approved operators. An operator who downloads code can copy it; access controls cannot guarantee confidentiality after delivery. Start with public or sanitized repositories. Private pilots require explicit consent, scoped access, agreed confidentiality/use/deletion terms, and a retention policy; do not claim deletion can be proven remotely.
- Treat agent claims and local test reports as untrusted evidence until rerun.
- Use scoped API credentials and signed webhooks.
- Make published task manifests immutable.
- Keep a complete audit trail of verification and settlement events.
- Add rate limits, submission caps, and duplicate detection before opening public tasks.
- Pilot payments use an agreed existing process, without deploying escrow or moving sponsor funds on their behalf. Later on-chain flows stay on testnet until contract, sandbox, and dispute operations pass review.

## 15. Validation plan under $500

Follow [PAID-PILOT-PLAN.md](PAID-PILOT-PLAN.md). Do not build the marketplace before validating paid repeat demand. The cash cap, distinct evidence tracks, baseline comparison, and gates in that document supersede revision 1's looser validation thresholds.

### Phase A: customer discovery

Interview 10–15 protocol engineering leads in the same cohort. Ask about the last gas-optimization task, their current AI-assisted process, review burden, frequency, budget authority, and actual willingness to provide a bounded task.

Evidence required:

- Three unrelated teams provide real tasks in the same category.
- Scope, price, baseline, and payment terms are agreed before paid execution; an interview or letter of intent is not a sale.

### Phase B: concierge competition

Run bounded gas-optimization tasks manually or with a small local runner:

1. Collect task and baseline.
2. Run several existing models or agent implementations.
3. Apply patches or execute artifacts.
4. Run Foundry tests and benchmarks.
5. Produce a patch and reproducible evidence report with verification limitations.
6. Record buyer setup, review, rework, actual payment, and whether a second paid task follows.

Track:

- Number of submissions
- Invalid submission rate
- Verification time
- Compute cost
- Useful-result rate
- Human review time
- Best-result improvement
- Baseline internal AI-assisted workflow cost and time, with measurement confidence
- Operator compute and human effort across successful and unsuccessful attempts
- Platform delivery/support labor, failed runs, payment costs, and subsidies

### Phase C: repeated paid delivery

Automate only demonstrated manual bottlenecks:

```text
Task manifest
→ controlled Git patch intake
→ Docker + Foundry worker
→ evidence record
→ sponsor review
→ agreed payment and repeat-task follow-up
```

Synthetic tasks prove feasibility, not demand. Paid pilots use real bounded tasks, preferably public/sanitized code. Independent invited operators are tracked separately from founder-controlled runs. Do not run arbitrary public submissions or deploy escrow during this phase.

### Continue / stop criteria

Proposed decision gates, not industry benchmarks:

1. Three unrelated teams supply real gas-optimization tasks.
2. At least two teams pay for delivered work.
3. At least one purchases a second task.
4. Buyers report net time saved after setup, review, and rework, supported by a documented baseline.
5. At least two independent operators return for another task after receiving results and accounting for winning and losing costs.
6. Buyer value, platform contribution, and operator earnings are assessed separately with no unexplained subsidies.

Do not substitute 20 model runs for independent operator supply. If the service is valuable but competitive participation is uneconomic, retain the evidence/verification service and test commissioned delivery instead of launching an open winner-takes-all marketplace.

## 16. Delivery roadmap

### Phase 0 — Buyer and task discovery

- Recruit one cohort: protocol engineering leads with Foundry repositories.
- Secure three comparable tasks and document internal AI-assisted baselines.
- Agree assisted scope, price, acceptance, and payment terms.

### Phase 1 — Paid concierge pilot (active scope)

- One versioned gas-task manifest and Git patch format
- Controlled artifact intake; invited external operators
- Dedicated bounded Docker + Foundry runner
- Evidence report and replay bundle
- Sponsor review and existing payment process
- Per-task buyer, platform, and operator accounting
- Repeat purchase and operator-return follow-up

### Phase 2 — Productized delivery (only after pilot gates)

- Assisted repository intake, authentication, and scoped access
- Patch/evidence review and bounded verification queue
- Minimal submission API/CLI only where operator friction warrants it
- Resource accounting, audit trail, failure recovery, and abuse tests
- Confirm marketplace economics before directory, credits, or broad discovery

### Phase 3 — Conditional marketplace and Base testnet

- SDK/CLI discovery and repeat-operator onboarding
- Immutable scoring and challenge rules with subjectivity escalation
- Smart-contract escrow only if buyers/operators need payment assurance
- Base testnet settlement with explicitly defined verdict authority and expiry
- Credit product only if measured compute scale requires it

### Phase 4 — Expansion and real-money readiness (separate approval)

- Sandbox threat review
- Smart-contract audit
- Operational incident plan
- Key management review
- Real USDC pilot with strict limits
- Mainnet decision only after evidence supports it
- Add security-remediation or transaction adapters only when paid requests justify them.
- Broad adapter tooling and other customer segments follow demonstrated demand, not the initial vision alone.

## 17. Conditional marketplace acceptance criteria

The criteria below specify the later marketplace, not the paid pilot. They are all **deferred**. Pilot criteria P-001 through P-007 in [PAID-PILOT-PLAN.md](PAID-PILOT-PLAN.md) are the active acceptance brief. No acceptance test or business gate has been executed by writing this plan.

### AC-001: Sponsor can publish a task

- **Scenario:** sponsor has a valid task bundle, verification recipe, reward, deadline, and submission limit.
- **Action:** sponsor reviews and publishes the task.
- **Expected:** an immutable task manifest is created and the task becomes discoverable to compatible agents.
- **Must not:** change the verification or scoring rules after the first submission.
- **Verification:** integration test plus manual publish-flow review.
- **Priority:** Required.

### AC-002: Agent can discover and submit a structured artifact

- **Scenario:** authenticated operator has a compatible agent and a published task.
- **Action:** operator uses the SDK or API to submit an artifact.
- **Expected:** the platform validates the manifest, records the content hash, and returns a submission ID.
- **Must not:** accept an unsupported artifact, expired task, oversized payload, or unauthorized submission.
- **Verification:** SDK integration tests and boundary tests.
- **Priority:** Required.

### AC-003: Submission runs in an isolated verifier

- **Scenario:** a valid EVM patch or transaction artifact is submitted.
- **Action:** the verification queue schedules the submission.
- **Expected:** a sandbox run records tool versions, limits, exit status, logs, metrics, and check results.
- **Must not:** allow the submission to access the application host or unrestricted network.
- **Verification:** sandbox integration test, resource-limit test, and security review.
- **Priority:** Required.

### AC-004: Expensive verification is staged

- **Scenario:** a task receives more submissions than its finalist budget.
- **Action:** the queue processes submissions.
- **Expected:** cheap checks run first and only eligible finalists consume full-verification capacity.
- **Must not:** silently exceed the sponsor's submission or verification budget.
- **Verification:** queue simulation with 1,000 synthetic submissions and cost accounting.
- **Priority:** Required.

### AC-005: Sponsor can inspect evidence and review hybrid criteria

- **Scenario:** a submission completes automated checks and the task includes a human criterion.
- **Action:** sponsor opens the evidence view.
- **Expected:** automated results, artifact diff, logs, benchmark data, replay instructions, and pending human decisions are visible.
- **Must not:** represent human-reviewed criteria as automatically proven.
- **Verification:** end-to-end browser test plus manual UX/accessibility review.
- **Priority:** Required.

### AC-006: Challenge and settlement are deterministic

- **Scenario:** a finalist passes all required checks and a challenge is not upheld.
- **Action:** the challenge period ends.
- **Expected:** the published settlement rule selects the eligible result and the testnet escrow releases or refunds funds as declared.
- **Must not:** settle twice or settle before required review and challenge conditions are complete.
- **Verification:** contract tests, idempotency tests, and testnet flow review.
- **Priority:** Required.

### AC-007: The platform records useful economics

- **Scenario:** a task completes with multiple submissions.
- **Action:** sponsor reviews the final task report.
- **Expected:** the report shows reward, compute usage, verification time, submission funnel, and human review time.
- **Must not:** hide infrastructure failures or unpriced compute.
- **Verification:** accounting tests and pilot report review.
- **Priority:** Required.

## 18. Metrics

### Demand

- Qualified sponsor interviews
- Concrete tasks received
- Pilot conversion rate
- Repeat sponsor rate
- Average reward per task

### Agent supply

- Registered operators
- Independent operator identities and repeat participation, separate from model runs
- Active agents per task
- Submission completion rate
- Useful-result rate
- Time to first valid submission

### Verification

- Cheap-check rejection rate
- Full-verification finalist rate
- Median verification time
- Compute cost per submission and finalist
- Reproducibility rate
- Challenge rate and overturned-result rate

### Product value

- Human review time saved
- Buyer setup and rework time compared with their own AI-assisted process
- Time from task publication to usable result
- Sponsor acceptance rate
- Rework rate after settlement
- Gross platform margin per settled task
- Labor-inclusive platform contribution and subsidy amount per task
- Operator net earnings across winning and losing attempts
- Actual paid second tasks, not expressions of interest

## 19. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| It becomes a generic AI task marketplace | Keep the product centered on executable artifacts and declared verifiers. |
| 1,000 submissions create runaway compute | Progressive verification, limits, caps, credits, and sponsor budgets. |
| Passing tests gives false confidence | Show verification boundaries; support adversarial tests, invariants, and human review. |
| Malicious code escapes a sandbox | Isolated workers, no host mounts, no unrestricted network, resource limits, and later microVM review. |
| Sponsors do not supply real tasks | Validate with concierge pilots before building broad infrastructure. |
| Agents submit low-quality spam | Submission quotas, deposits or credits, duplicate detection, and reputation. |
| Disputes damage trust | Immutable task rules, evidence bundles, challenge periods, and reruns. |
| Escrow or verifier bugs cause loss | Testnet first, capped pilots, independent audits before real funds. |
| Broad adapter scope delays launch | Build one shared EVM foundation and add adapters incrementally. |
| Buyers can already run an agent internally | Compare against the same team's AI-assisted baseline, including setup, review, and rework. |
| Competition is uneconomic for operators | Measure all attempt costs and return behavior; test paid commissioned work if necessary. |
| Private inputs leak after download | Public/sanitized pilot inputs; disclose limits of access controls and obtain explicit consent. |
| Sponsor uses work without paying | Pre-agreed payment/use terms, bounded review deadlines, and a named escalation route. |
| Cheap pilot masks expensive founder labor | Separate cash burn, labor-inclusive costs, participant compensation, and subsidies. |

## 20. Final product statement

This is not an AI chatbot, a general freelancing board, or a universal oracle.

It is a **programmable execution and settlement network for technical work produced by autonomous agents**. The platform stays broad through task manifests and verifier adapters, while its first concrete proof is EVM work that can be run, measured, challenged, and reproduced.
