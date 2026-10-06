import { randomUUID } from "node:crypto";
import type { MarketplaceProfile, PilotEvidence, PilotEvent, PilotList, PilotSubmission, PilotTask, PilotTaskDetail, PilotTaskInput, PilotUser, ReviewChallenge } from "../pilot-types";
import { getReferenceBundle, recordExternalEvidence, runReferenceVerification, validatePatch } from "../pilot-verifier";
import { calculatePilotLedger } from "../pilot-ledger";
import { canAcceptSubmission } from "../pilot-eligibility";
import { capabilityMatch, rankSubmissions } from "../marketplace";
import { queueTaskInvitation, requireUser } from "./auth";
import { PilotError } from "./errors";
import { audit, getPilotStore, manifestHash, sha256, type AuditEvent, type PilotState, type StoredReservation } from "./store";
import { challengeInput, challengeResolutionInput, draftChanges, emptyLedger, externalReport, ledgerInput, profileInput, reviewInput, submissionInput, taskInput, TASK_FIELDS } from "./validation";

function findTask(state: PilotState, id: string): PilotTask {
  const task = state.tasks.find(item => item.id === id);
  if (!task) throw new PilotError(404, "Task not found.");
  return task;
}

function canAccess(task: PilotTask, user: PilotUser): boolean {
  return task.ownerId === user.id || (task.status !== "draft" && !!task.publishedAt && (task.inviteEmails.length === 0 || task.inviteEmails.includes(user.email)));
}

function access(task: PilotTask, user: PilotUser): void {
  if (!canAccess(task, user)) throw new PilotError(403, "You do not have access to this task.");
}

function owner(task: PilotTask, user: PilotUser): void {
  if (task.ownerId !== user.id) throw new PilotError(403, "Only the task owner can perform this action.");
}

function findSubmission(state: PilotState, id: string, user: PilotUser): { task: PilotTask; submission: PilotSubmission } {
  const submission = state.submissions.find(item => item.id === id);
  if (!submission) throw new PilotError(404, "Submission not found.");
  const task = findTask(state, submission.taskId);
  access(task, user);
  if (task.ownerId !== user.id && submission.operatorId !== user.id) throw new PilotError(403, "You do not have access to this submission.");
  return { task, submission };
}

function visibleTask(state: PilotState, task: PilotTask, user: PilotUser): PilotTask {
  const result = { ...task };
  if (task.ownerId !== user.id) {
    result.inviteEmails = [user.email];
    if (result.acceptedSubmissionId && !state.submissions.some(submission => submission.id === result.acceptedSubmissionId && submission.operatorId === user.id)) delete result.acceptedSubmissionId;
  }
  return result;
}

function visibleEvent(event: AuditEvent): PilotEvent {
  return { id: event.id, taskId: event.taskId, actorName: event.actorName, type: event.type, message: event.message, at: event.at };
}

function taskEvents(state: PilotState, task: PilotTask, user: PilotUser): PilotEvent[] {
  return state.events.filter(event => event.taskId === task.id && (!event.privateOperatorId || task.ownerId === user.id || event.privateOperatorId === user.id)).map(visibleEvent);
}

function detail(state: PilotState, task: PilotTask, user: PilotUser): PilotTaskDetail {
  access(task, user);
  return {
    task: visibleTask(state, task, user),
    submissions: task.ownerId === user.id
      ? rankSubmissions(task, state.submissions.filter(submission => submission.taskId === task.id))
      : state.submissions.filter(submission => submission.taskId === task.id && submission.operatorId === user.id),
    events: taskEvents(state, task, user),
    challenges: state.challenges.filter(challenge => challenge.taskId === task.id && (task.ownerId === user.id || challenge.challengerId === user.id)),
    escrows: state.escrows.filter(escrow => escrow.taskId === task.id && (escrow.sponsorId === user.id || escrow.operatorId === user.id)),
  };
}

function editableEvidence(task: PilotTask, submission: PilotSubmission): void {
  if (task.status === "draft" || task.status === "archived" || task.status === "accepted" || submission.review) throw new PilotError(409, "Evidence cannot be changed after review or task closure.");
}

function activeReservation(state: PilotState, taskId: string, operatorId: string, now: number): StoredReservation | undefined {
  const reservation = state.reservations.find(item => item.taskId === taskId && item.operatorId === operatorId && !item.releasedAt);
  if (reservation && Date.parse(reservation.expiresAt) <= now) {
    reservation.releasedAt = new Date(now).toISOString();
    return undefined;
  }
  return reservation;
}

function reserveWithinState(state: PilotState, task: PilotTask, user: PilotUser, now: number): StoredReservation {
  access(task, user);
  if (!task.publishedAt || !["open", "review"].includes(task.status)) throw new PilotError(409, "This task is not accepting reservations.");
  if (Date.parse(task.deadline) <= now) throw new PilotError(409, "The task deadline has passed.");
  const existing = activeReservation(state, task.id, user.id, now);
  if (existing) return existing;
  const active = state.reservations.filter(item => item.taskId === task.id && !item.releasedAt && Date.parse(item.expiresAt) > now).length;
  const submitted = state.submissions.filter(submission => submission.taskId === task.id).length;
  if (submitted + active >= task.maxSubmissions) throw new PilotError(409, "The task has no remaining submission reservations.");
  const createdAt = new Date(now).toISOString();
  const reservation: StoredReservation = { id: randomUUID(), taskId: task.id, operatorId: user.id, expiresAt: new Date(Math.min(Date.parse(task.deadline), now + 24 * 60 * 60 * 1000)).toISOString(), createdAt };
  state.reservations.push(reservation);
  return reservation;
}

export async function reserveTask(id: string, token?: string): Promise<StoredReservation> {
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const task = findTask(state, id);
    const reservation = reserveWithinState(state, task, user, Date.now());
    audit(state, user, task.id, "task.reserved", `Task reserved through ${reservation.expiresAt}.`);
    return reservation;
  });
}

export async function releaseTaskReservation(id: string, token?: string): Promise<{ released: true }> {
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const task = findTask(state, id);
    access(task, user);
    const reservation = activeReservation(state, task.id, user.id, Date.now());
    if (!reservation) throw new PilotError(404, "Active task reservation not found.");
    reservation.releasedAt = new Date().toISOString();
    audit(state, user, task.id, "task.reservation-released", "Task reservation released.");
    return { released: true as const };
  });
}

export async function listTasks(token?: string): Promise<PilotList> {
  const state = await getPilotStore().read();
  const user = requireUser(state, token);
  const tasks = state.tasks.filter(task => canAccess(task, user));
  return { tasks: tasks.map(task => visibleTask(state, task, user)), events: tasks.flatMap(task => taskEvents(state, task, user)).sort((a, b) => b.at.localeCompare(a.at)) };
}

function profileFor(state: PilotState, user: PilotUser): MarketplaceProfile {
  return state.profiles.find(profile => profile.userId === user.id) ?? {
    userId: user.id, handle: user.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `operator-${user.id.slice(-8)}`,
    bio: "", capabilities: [], adapterVersions: {}, availability: "available", completedCount: 0, acceptedCount: 0, challengedCount: 0, challengeFailures: 0, createdAt: user.createdAt, updatedAt: user.createdAt,
  };
}

export async function getProfile(token?: string): Promise<MarketplaceProfile> {
  const state = await getPilotStore().read();
  const user = requireUser(state, token);
  return profileFor(state, user);
}

export async function updateProfile(value: unknown, token?: string): Promise<MarketplaceProfile> {
  const input = profileInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const existing = state.profiles.find(profile => profile.userId === user.id);
    if (state.profiles.some(profile => profile.userId !== user.id && profile.handle === input.handle)) throw new PilotError(409, "That marketplace handle is already in use.", { handle: "Choose another handle." });
    const now = new Date().toISOString();
    const profile: MarketplaceProfile = existing ? { ...existing, ...input, updatedAt: now } : { ...input, userId: user.id, completedCount: 0, acceptedCount: 0, challengedCount: 0, challengeFailures: 0, createdAt: now, updatedAt: now };
    if (existing) Object.assign(existing, profile); else state.profiles.push(profile);
    audit(state, user, "", "profile.updated", "Marketplace operator profile updated.");
    return profile;
  });
}

export async function marketplaceProfiles(query: string, token?: string): Promise<{ profiles: MarketplaceProfile[] }> {
  const state = await getPilotStore().read();
  requireUser(state, token);
  const normalized = query.trim().toLowerCase();
  return { profiles: state.profiles.filter(profile => profile.availability !== "hidden" && (!normalized || [profile.handle, profile.bio, ...profile.capabilities].some(value => value.toLowerCase().includes(normalized)))) };
}

export async function marketplaceTasks(query: string, token?: string): Promise<{ tasks: PilotTask[] }> {
  const state = await getPilotStore().read();
  const user = requireUser(state, token);
  const profile = profileFor(state, user);
  const normalized = query.trim().toLowerCase();
  const tasks = state.tasks.filter(task => {
    if (!["open", "review"].includes(task.status) || (task.inviteEmails.length > 0 && !task.inviteEmails.includes(user.email))) return false;
    if (normalized && ![task.title, task.description, task.target, task.constraints].some(value => value.toLowerCase().includes(normalized))) return false;
    return profile.capabilities.length === 0 || capabilityMatch(task, profile).matched.length > 0;
  }).sort((left, right) => capabilityMatch(right, profile).score - capabilityMatch(left, profile).score || right.updatedAt.localeCompare(left.updatedAt));
  return { tasks: tasks.map(task => visibleTask(state, task, user)) };
}

export async function getTask(id: string, token?: string): Promise<PilotTaskDetail> {
  const state = await getPilotStore().read();
  const user = requireUser(state, token);
  return detail(state, findTask(state, id), user);
}

export async function createTask(value: unknown, token?: string): Promise<PilotTask> {
  const input = taskInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    if (state.tasks.length >= 10_000) throw new PilotError(503, "This pilot has reached its task capacity.");
    const now = new Date().toISOString();
    const task: PilotTask = { ...input, id: randomUUID(), ownerId: user.id, ownerName: user.name, status: "draft", createdAt: now, updatedAt: now, ledger: emptyLedger() };
    state.tasks.push(task);
    audit(state, user, task.id, "task.created", "Private task draft created.");
    return task;
  });
}

export async function editTask(id: string, value: unknown, token?: string): Promise<PilotTask> {
  const changes = draftChanges(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const task = findTask(state, id);
    owner(task, user);
    if (task.status !== "draft" || task.manifestHash) throw new PilotError(409, "Published task terms are immutable. Create a new draft for changed terms.");
    const current = Object.fromEntries(TASK_FIELDS.map(key => [key, task[key]]));
    const input = taskInput({ ...current, ...changes });
    Object.assign(task, input, { updatedAt: new Date().toISOString() });
    audit(state, user, task.id, "task.edited", "Draft terms updated.");
    return task;
  });
}

export async function publishTask(id: string, token?: string): Promise<PilotTask> {
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const task = findTask(state, id);
    owner(task, user);
    if (task.status !== "draft" || task.manifestHash) throw new PilotError(409, "Only an unpublished draft can be published.");
    if (Date.parse(task.deadline) <= Date.now()) throw new PilotError(400, "Set a future deadline before publishing.", { deadline: "The publication deadline must be in the future." });
    task.manifestHash = manifestHash(task);
    task.status = "open";
    task.publishedAt = new Date().toISOString();
    task.updatedAt = task.publishedAt;
    for (const email of task.inviteEmails) {
      if (!state.users.some(candidate => candidate.email === email) && !state.invitations.some(invitation => invitation.email === email && !invitation.usedAt && Date.parse(invitation.expiresAt) > Date.now())) {
        queueTaskInvitation(state, email, task.id, user.name);
      }
    }
    audit(state, user, task.id, "task.published", `Task published with immutable manifest ${task.manifestHash}. No funds were transferred.`);
    return task;
  });
}

export async function archiveTask(id: string, token?: string): Promise<PilotTask> {
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const task = findTask(state, id);
    owner(task, user);
    if (task.status === "archived") throw new PilotError(409, "This task is already archived.");
    task.status = "archived";
    task.updatedAt = new Date().toISOString();
    audit(state, user, task.id, "task.archived", "Task archived. Submissions and evidence remain private and retained.");
    return task;
  });
}

export async function updateLedger(id: string, value: unknown, token?: string): Promise<PilotTask> {
  const ledger = ledgerInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const task = findTask(state, id);
    owner(task, user);
    task.ledger = ledger;
    task.updatedAt = new Date().toISOString();
    audit(state, user, task.id, "ledger.updated", `Bookkeeping recorded manually (${ledger.paymentStatus}). This entry is not evidence of a Vector-executed payment; no transfer was performed.`);
    return task;
  });
}

export async function createSubmission(id: string, value: unknown, token?: string): Promise<PilotSubmission> {
  const input = submissionInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const task = findTask(state, id);
    access(task, user);
    if (!["open", "review"].includes(task.status) || !task.manifestHash) throw new PilotError(409, "This task is not accepting submissions.");
    if (Date.parse(task.deadline) <= Date.now()) throw new PilotError(409, "The submission deadline has passed.");
    if (input.baseCommit !== task.baseCommit) throw new PilotError(400, "The submission must use the published base commit.", { baseCommit: "Base commit does not match the immutable task." });
    try { validatePatch(input.patch, task.scopePaths); }
    catch { throw new PilotError(400, "The patch is invalid or outside the declared scope.", { patch: "Use a supported unified Solidity diff that changes only the published scope." }); }
    const artifactHash = sha256(input.patch);
    if (state.submissions.some(submission => submission.taskId === task.id && submission.artifactHash === artifactHash)) throw new PilotError(409, "This patch has already been submitted to the task.");
    if (state.submissions.filter(submission => submission.taskId === task.id).length >= task.maxSubmissions) throw new PilotError(409, "The published submission cap has been reached.");
    const now = new Date().toISOString();
    const reservation = activeReservation(state, task.id, user.id, Date.parse(now)) ?? reserveWithinState(state, task, user, Date.parse(now));
    const submission: PilotSubmission = { ...input, id: randomUUID(), taskId: task.id, operatorId: user.id, operatorName: user.name, artifactHash, status: "received", createdAt: now, updatedAt: now };
    state.submissions.push(submission);
    reservation.releasedAt = now;
    if (task.fixture === "external") {
      state.jobs.push({ id: randomUUID(), taskId: task.id, submissionId: submission.id, status: "queued", attempts: 0, maxAttempts: 3, availableAt: now });
    }
    task.status = "review";
    task.updatedAt = now;
    audit(state, user, task.id, "submission.created", `Submission ${submission.id} received with artifact ${artifactHash}.`, user.id);
    return submission;
  });
}

export async function verifySubmission(id: string, token?: string): Promise<PilotSubmission> {
  // Run the trusted, fixed reference verifier outside the storage transaction. Recheck authorization and state when saving.
  const snapshot = await getPilotStore().read();
  const user = requireUser(snapshot, token);
  const { task, submission } = findSubmission(snapshot, id, user);
  editableEvidence(task, submission);
  if (task.fixture !== "reference") throw new PilotError(409, "Custom repositories are not executed here. Record an external report instead; it remains unverified.");
  if (submission.evidence) throw new PilotError(409, "Reference evidence has already been recorded. Submit a new patch for a new run.");
  let evidence: PilotEvidence;
  try { evidence = await runReferenceVerification(task, submission); }
  catch { throw new PilotError(503, "The reference verifier could not complete. Check the local reference toolchain and try again."); }
  if (evidence.checks.some(check => check.name === "Bounded reference worker completion" && !check.passed)) {
    throw new PilotError(503, "The reference worker is busy or unavailable. No result was recorded. Reload the task before retrying.");
  }
  return getPilotStore().mutate(state => {
    const currentUser = requireUser(state, token);
    const current = findSubmission(state, id, currentUser);
    editableEvidence(current.task, current.submission);
    if (current.submission.updatedAt !== submission.updatedAt) throw new PilotError(409, "Submission evidence changed during verification. Reload before trying again.");
    if (evidence.artifactHash !== current.submission.artifactHash || evidence.source !== "reference-run") throw new PilotError(503, "The reference verifier returned mismatched evidence.");
    current.submission.evidence = evidence;
    current.submission.status = evidence.outcome === "passed" ? "verified" : "failed";
    current.submission.updatedAt = new Date().toISOString();
    current.task.updatedAt = current.submission.updatedAt;
    audit(state, currentUser, current.task.id, "submission.verified", `Reference verification for ${id}: ${evidence.outcome}.`, current.submission.operatorId);
    return current.submission;
  });
}

export async function recordReport(id: string, value: unknown, token?: string): Promise<PilotSubmission> {
  const report = externalReport(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const { task, submission } = findSubmission(state, id, user);
    editableEvidence(task, submission);
    if (task.fixture !== "external") throw new PilotError(409, "Reference tasks require the bundled verifier; external reports cannot replace reference checks.");
    try { submission.evidence = recordExternalEvidence(submission, report); }
    catch { throw new PilotError(400, "The external report is invalid or exceeds the report limits.", { report: "Provide bounded environment details, checks, metrics, logs, replay instructions, and limitations." }); }
    submission.status = "recorded";
    submission.updatedAt = new Date().toISOString();
    task.updatedAt = submission.updatedAt;
    audit(state, user, task.id, "submission.reported", `External evidence recorded for ${id}. Vector has not independently executed or verified the report.`, submission.operatorId);
    return submission;
  });
}

export async function reviewSubmission(id: string, value: unknown, token?: string): Promise<PilotSubmission> {
  const review = reviewInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const { task, submission } = findSubmission(state, id, user);
    owner(task, user);
    if (task.status === "draft" || task.status === "archived" || submission.review) throw new PilotError(409, "This submission is already reviewed or the task is closed.");
    if (review.decision === "accept") {
      if (task.acceptedSubmissionId || state.submissions.some(item => item.taskId === task.id && item.status === "accepted")) throw new PilotError(409, "This task already has an accepted winner.");
      if (!canAcceptSubmission(task, submission)) throw new PilotError(409, "Acceptance requires passing, artifact-bound checks and measurements meeting the published improvement target.");
      task.acceptedSubmissionId = submission.id;
      task.status = "accepted";
    }
    const now = new Date().toISOString();
    submission.review = { ...review, reviewerName: user.name, at: now };
    submission.status = review.decision === "accept" ? "accepted" : "rejected";
    submission.updatedAt = now;
    task.updatedAt = now;
    task.ledger.reviewMinutes += review.minutes;
    if (task.ledger.reviewMinutes > 1_000_000) throw new PilotError(400, "Total review minutes exceed the ledger limit.");
    audit(state, user, task.id, `submission.${submission.status}`, `Submission ${id} ${submission.status}: ${review.reason.slice(0, 3000)}${review.decision === "accept" ? " Acceptance records a review decision only; no payment was transferred." : ""}`, submission.operatorId);
    return submission;
  });
}

export async function openChallenge(id: string, value: unknown, token?: string): Promise<ReviewChallenge> {
  const input = challengeInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const { task, submission } = findSubmission(state, id, user);
    if (submission.operatorId !== user.id || task.acceptedSubmissionId !== submission.id || submission.status !== "accepted" || !submission.review || submission.review.decision !== "accept") throw new PilotError(409, "Only the accepted operator can challenge an active acceptance.");
    if (Date.parse(submission.review.at) + 48 * 60 * 60 * 1000 <= Date.now()) throw new PilotError(409, "The 48-hour challenge window has closed.");
    if (state.challenges.some(challenge => challenge.submissionId === submission.id)) throw new PilotError(409, "This submission already has a recorded challenge.");
    const now = new Date().toISOString();
    const challenge: ReviewChallenge = { id: randomUUID(), taskId: task.id, submissionId: submission.id, challengerId: user.id, challengerName: user.name, reason: input.reason, openedAt: now, expiresAt: new Date(Date.parse(submission.review.at) + 48 * 60 * 60 * 1000).toISOString(), status: "open" };
    state.challenges.push(challenge);
    const profile = state.profiles.find(item => item.userId === user.id);
    if (profile) { profile.challengedCount += 1; profile.updatedAt = now; }
    audit(state, user, task.id, "submission.challenge-opened", `Challenge opened for accepted submission ${submission.id}.`, submission.operatorId);
    return challenge;
  });
}

export async function resolveChallenge(id: string, value: unknown, token?: string): Promise<ReviewChallenge> {
  const input = challengeResolutionInput(value);
  return getPilotStore().mutate(state => {
    const user = requireUser(state, token);
    const challenge = state.challenges.find(item => item.id === id);
    if (!challenge) throw new PilotError(404, "Challenge not found.");
    const task = findTask(state, challenge.taskId);
    owner(task, user);
    if (challenge.status !== "open") throw new PilotError(409, "This challenge is already resolved.");
    const submission = state.submissions.find(item => item.id === challenge.submissionId);
    if (!submission || !submission.review) throw new PilotError(409, "The challenged submission is no longer reviewable.");
    const now = new Date().toISOString();
    challenge.status = "resolved";
    challenge.resolution = input.decision;
    challenge.resolutionReason = input.reason;
    challenge.resolverId = user.id;
    challenge.resolverName = user.name;
    challenge.resolvedAt = now;
    if (input.decision === "uphold") {
      task.status = "review";
      delete task.acceptedSubmissionId;
      submission.status = "rejected";
      submission.review.supersededByChallenge = true;
    } else {
      const profile = state.profiles.find(item => item.userId === challenge.challengerId);
      if (profile) { profile.challengeFailures += 1; profile.updatedAt = now; }
    }
    task.updatedAt = now;
    audit(state, user, task.id, "submission.challenge-resolved", `Challenge ${challenge.id} resolved: ${input.decision}.`, challenge.challengerId);
    return challenge;
  });
}

export async function submissionArtifact(id: string, token?: string): Promise<{ patch: string; filename: string }> {
  const state = await getPilotStore().read();
  const user = requireUser(state, token);
  const { submission } = findSubmission(state, id, user);
  return { patch: submission.patch, filename: `vector-${submission.id}.patch` };
}

export function ledgerEconomics(task: PilotTask) {
  const amounts = calculatePilotLedger(task.ledger);
  return {
    ...amounts,
    platformNetUsd: amounts.platformContributionUsd,
    operatorNetUsd: amounts.operatorContributionUsd,
    sponsorCommittedUsd: task.priceUsd,
    operatorRewardCommittedUsd: task.operatorRewardUsd,
    workflowMinutes: amounts.buyerMinutes,
    timeSavedMinutes: amounts.buyerNetMinutes,
  };
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+!|>]/g, "\\$&").replace(/</g, "&lt;").replace(/&(?!(?:lt);)/g, "&amp;");
}

function recordedMoney(value: number | null): string {
  return value === null ? "Unknown (hourly rate not recorded)" : `$${value.toFixed(2)}`;
}

export async function exportTask(id: string, format: string, token?: string): Promise<{ content: string; type: string; filename: string }> {
  if (format !== "json" && format !== "markdown") throw new PilotError(400, "Choose export format json or markdown.");
  const data = await getTask(id, token);
  const economics = ledgerEconomics(data.task);
  const notes = ["Private pilot evidence export, filtered for the signed-in account.", "External reports are manually recorded operator evidence, not independently verified execution.", "Sponsor operator-reward pass-through is excluded from platform service revenue and platform profit.", "Payment status is manually recorded bookkeeping. Vector does not transfer funds or attest that a payment occurred."];
  if (format === "json") return { content: JSON.stringify({ ...data, economics, notes }, null, 2), type: "application/json; charset=utf-8", filename: `vector-${id}.json` };
  const { task, submissions, events } = data;
  const lines = [
    `# ${markdownText(task.title)}`, "", ...notes.map(note => `- ${note}`), "",
    `Task: ${task.id}`, `Status: ${task.status}`, `Manifest SHA-256: ${task.manifestHash ?? "Unpublished"}`, `Base commit: ${task.baseCommit}`, `Scope: ${task.scopePaths.map(markdownText).join(", ")}`, `Deadline: ${task.deadline}`, "",
    "## Published terms", markdownText(task.description), "", `Target: ${markdownText(task.target)}`, `Constraints: ${markdownText(task.constraints)}`, `Minimum improvement: ${task.minImprovementPct}%`, `Sponsor total: $${task.priceUsd.toFixed(2)}`, `Operator reward: $${task.operatorRewardUsd.toFixed(2)}`, `Payment terms: ${markdownText(task.paymentTerms)}`, `Review terms: ${markdownText(task.reviewTerms)}`, "",
    "## Manually recorded ledger", `Service revenue (excludes reward pass-through): $${task.ledger.serviceRevenueUsd.toFixed(2)}`, `Operator payment recorded: $${task.ledger.operatorPaidUsd.toFixed(2)}`, `Platform cash contribution: ${recordedMoney(economics.platformCashUsd)}`, `Platform labor-inclusive contribution: ${recordedMoney(economics.platformNetUsd)}`, `Operator cash after compute: ${recordedMoney(economics.operatorCashUsd)}`, `Operator labor-inclusive return: ${recordedMoney(economics.operatorNetUsd)}`, `Workflow minutes: ${economics.workflowMinutes}`, `Time saved minutes: ${economics.timeSavedMinutes ?? "Unknown (baseline not recorded)"}`, `Payment status: ${task.ledger.paymentStatus}`, `Payment reference: ${markdownText(task.ledger.paymentReference)}`, "",
  ];
  for (const submission of submissions) {
    lines.push(`## Submission ${submission.id}`, `Operator: ${markdownText(submission.operatorName)}`, `Status: ${submission.status}`, `Artifact SHA-256: ${submission.artifactHash}`, `Method: ${markdownText(submission.method)}`);
    if (submission.evidence) {
      const evidence = submission.evidence;
      lines.push(`Evidence source: ${evidence.source}${evidence.source === "external-report" ? " (recorded; unverified)" : ""}`, `Outcome: ${evidence.outcome}`, `Environment: ${markdownText(evidence.environment)}`, `Replay instructions (not executed by export): ${markdownText(evidence.replayCommand)}`);
      lines.push(...evidence.checks.map(check => `- ${check.passed ? "PASS" : "FAIL"}: ${markdownText(check.name)} — ${markdownText(check.detail)}`));
      lines.push(...evidence.metrics.map(metric => `- ${markdownText(metric.name)}: ${metric.baseline} → ${metric.candidate} (${metric.improvementPct.toFixed(2)}%)`));
      lines.push(...evidence.limitations.map(limitation => `- Limitation: ${markdownText(limitation)}`), ...evidence.logs.map(log => `- Log: ${markdownText(log)}`));
    }
    if (submission.review) lines.push(`Review: ${submission.review.decision} — ${markdownText(submission.review.reason)} (${submission.review.minutes} minutes)`);
    const fence = "`".repeat(Math.max(3, ...[...submission.patch.matchAll(/`+/g)].map(match => match[0].length + 1)));
    lines.push("", `${fence}diff`, submission.patch, fence, "");
  }
  lines.push("## Audit events", ...events.map(event => `- ${event.at} ${event.type} (${markdownText(event.actorName)}): ${markdownText(event.message)}`));
  return { content: lines.join("\n"), type: "text/markdown; charset=utf-8", filename: `vector-${id}.md` };
}

export function referenceBundle(): ReturnType<typeof getReferenceBundle> {
  try { return getReferenceBundle(); }
  catch { throw new PilotError(503, "The pinned reference fixture is unavailable. Check the bundled reference files."); }
}

export type { PilotTaskInput };
