import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { PilotUser } from "../pilot-types.ts";
import { PilotError } from "./errors.ts";
import { audit, getPilotStore, sha256, type OutboxMessage, type PilotState, type StoredUser } from "./store.ts";
import { credentials } from "./validation.ts";

export const SESSION_COOKIE = "vector_pilot_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const TOKEN_SECONDS = 60 * 60;

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$16384$8$1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}

async function passwordMatches(password: string, storedHash?: string): Promise<boolean> {
  // Unknown accounts incur the same scrypt work and receive the same public error.
  const parts = storedHash?.split("$");
  const actual = await derive(password, parts?.[4] ?? "0".repeat(32));
  const expected = Buffer.from(parts?.[5] ?? "0".repeat(128), "hex");
  return timingSafeEqual(actual, expected) && !!storedHash;
}

export function publicUser(user: StoredUser): PilotUser {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt, emailVerified: Boolean(user.emailVerifiedAt) };
}

function inviteOnly(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VECTOR_INVITE_ONLY === "true";
}

function createToken(): string { return randomBytes(32).toString("base64url"); }

function seal(value: Record<string, string>): string {
  const key = createHash("sha256").update(process.env.SESSION_SECRET || "development-only-vector-outbox-key").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function openOutboxPayload(value: string): Record<string, string> {
  const [ivText, tagText, ciphertextText] = value.split(".");
  if (!ivText || !tagText || !ciphertextText) throw new Error("Invalid outbox payload");
  const key = createHash("sha256").update(process.env.SESSION_SECRET || "development-only-vector-outbox-key").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some(item => typeof item !== "string")) throw new Error("Invalid outbox payload");
  return parsed as Record<string, string>;
}

function outbox(state: PilotState, type: "email-verification" | "password-reset" | "invitation", to: string, payload: Record<string, string>): void {
  state.outbox.push({ id: randomUUID(), type, to, payload: { encrypted: seal(payload) }, createdAt: new Date().toISOString(), attempts: 0 });
}

export function queueTaskInvitation(state: PilotState, email: string, taskId: string, inviter: string): void {
  const invitationToken = createToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  state.invitations = state.invitations.filter(invitation => !(invitation.email === email && !invitation.usedAt));
  state.invitations.push({ id: randomUUID(), email, tokenHash: sha256(invitationToken), role: "member", taskId, createdAt: new Date().toISOString(), expiresAt });
  outbox(state, "invitation", email, { kind: "task-invitation", url: `${process.env.VECTOR_APP_ORIGIN || "http://localhost:3000"}/workspace?invite=${invitationToken}&view=tasks&task=${encodeURIComponent(taskId)}`, inviter });
}

function actionObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PilotError(400, "A JSON object is required.");
  return value as Record<string, unknown>;
}

function actionToken(value: unknown, key: string): string {
  const input = actionObject(value);
  if (Object.keys(input).some(name => name !== key)) throw new PilotError(400, "The request contains unsupported fields.");
  if (typeof input[key] !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(input[key] as string)) throw new PilotError(400, "The token is invalid or expired.");
  return input[key] as string;
}

function actionEmail(value: unknown): string {
  const input = actionObject(value);
  if (Object.keys(input).some(name => name !== "email")) throw new PilotError(400, "The request contains unsupported fields.");
  const email = normalizedActionEmail(input.email);
  if (!email) throw new PilotError(400, "Enter a valid email address.");
  return email;
}

function normalizedActionEmail(value: unknown): string | null {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function actionPassword(value: unknown): { token: string; password: string } {
  const input = actionObject(value);
  if (Object.keys(input).some(name => !["token", "password"].includes(name))) throw new PilotError(400, "The request contains unsupported fields.");
  if (typeof input.token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(input.token) || typeof input.password !== "string" || input.password.length < 12 || input.password.length > 256) throw new PilotError(400, "The token or password is invalid.");
  return { token: input.token, password: input.password };
}

export function cookieToken(request: Request): string | undefined {
  const value = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value && /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : undefined;
}

export function accessToken(request: Request): string | undefined {
  const cookie = cookieToken(request);
  if (cookie) return cookie;
  const bearer = request.headers.get("authorization")?.match(/^Bearer (vec_[a-zA-Z0-9_-]{43})$/);
  return bearer?.[1];
}

export async function touchApiToken(token?: string): Promise<void> {
  if (!token?.startsWith("vec_")) return;
  await getPilotStore().mutate(state => {
    const apiToken = state.apiTokens.find(candidate => candidate.tokenHash === sha256(token) && !candidate.revokedAt);
    if (apiToken) apiToken.lastUsedAt = new Date().toISOString();
  });
}

export function sessionUser(state: PilotState, token?: string): PilotUser | null {
  if (!token) return null;
  const session = state.sessions.find(item => item.tokenHash === sha256(token) && Date.parse(item.expiresAt) > Date.now());
  const apiToken = state.apiTokens.find(item => item.tokenHash === sha256(token) && !item.revokedAt);
  const user = state.users.find(item => item.id === (session?.userId || apiToken?.userId));
  return user ? publicUser(user) : null;
}

export function requireUser(state: PilotState, token?: string): PilotUser {
  const user = sessionUser(state, token);
  if (!user) throw new PilotError(401, "Sign in to continue.");
  const stored = state.users.find(item => item.id === user.id);
  if (process.env.NODE_ENV === "production" && !stored?.emailVerifiedAt) throw new PilotError(403, "Verify your email before using the marketplace.");
  return user;
}

function newSession(state: PilotState, user: PilotUser): string {
  const now = Date.now();
  state.sessions = state.sessions.filter(session => Date.parse(session.expiresAt) > now);
  const active = state.sessions.filter(session => session.userId === user.id);
  if (active.length >= 8) {
    const remove = new Set(active.slice(0, active.length - 7).map(session => session.tokenHash));
    state.sessions = state.sessions.filter(session => !remove.has(session.tokenHash));
  }
  const token = randomBytes(32).toString("base64url");
  state.sessions.push({ tokenHash: sha256(token), userId: user.id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_SECONDS * 1000).toISOString() });
  return token;
}

/** Persist throttle counters before any expensive password work; neither client IP headers nor memory resets bypass them. */
async function reserveAttempt(operation: "login" | "register", email: string): Promise<void> {
  const blocked = await getPilotStore().mutate(state => {
    const now = Date.now();
    state.attempts = state.attempts.filter(attempt => Date.parse(attempt.resetAt) > now);
    const buckets = [[`${operation}:account:${email}`, 8], [`${operation}:global`, operation === "register" ? 30 : 60]] as const;
    for (const [label, limit] of buckets) {
      const found = state.attempts.find(attempt => attempt.key === sha256(label));
      if (found && found.count >= limit) return Math.max(1, Math.ceil((Date.parse(found.resetAt) - now) / 1000));
    }
    for (const [label] of buckets) {
      const key = sha256(label);
      const found = state.attempts.find(attempt => attempt.key === key);
      if (found) found.count++;
      else state.attempts.push({ key, count: 1, resetAt: new Date(now + ATTEMPT_WINDOW).toISOString() });
    }
    return 0;
  });
  if (blocked) throw new PilotError(429, "Too many sign-in attempts. Try again later.", undefined, blocked);
}

export async function register(value: unknown): Promise<{ user: PilotUser; token: string }> {
  const input = credentials(value, true);
  await reserveAttempt("register", input.email);
  if (inviteOnly()) {
    const invitation = input.invitationToken ? (await getPilotStore().read()).invitations.find(item => item.email === input.email && item.tokenHash === sha256(input.invitationToken!) && !item.usedAt && Date.parse(item.expiresAt) > Date.now()) : undefined;
    if (!invitation) throw new PilotError(403, "This account requires a valid invitation.");
  }
  const passwordHash = await hashPassword(input.password);
  return getPilotStore().mutate(state => {
    if (state.users.some(user => user.email === input.email)) throw new PilotError(409, "Unable to create an account with those details. Try signing in.");
    if (state.users.length >= 10_000) throw new PilotError(503, "This pilot has reached its account capacity.");
    const invitation = input.invitationToken ? state.invitations.find(item => item.email === input.email && item.tokenHash === sha256(input.invitationToken!) && !item.usedAt && Date.parse(item.expiresAt) > Date.now()) : undefined;
    if (inviteOnly() && !invitation) throw new PilotError(403, "This account requires a valid invitation.");
    if (invitation) invitation.usedAt = new Date().toISOString();
    const verificationToken = createToken();
    const now = new Date().toISOString();
    const verifiedInDevelopment = process.env.NODE_ENV !== "production" && !inviteOnly();
    const stored: StoredUser = { id: randomUUID(), name: input.name!, email: input.email, passwordHash, role: invitation?.role || "member", createdAt: now, ...(verifiedInDevelopment ? { emailVerifiedAt: now } : { emailVerificationTokenHash: sha256(verificationToken), emailVerificationExpiresAt: new Date(Date.now() + TOKEN_SECONDS * 1000).toISOString(), emailVerificationSentAt: now }) };
    state.users.push(stored);
    const user = publicUser(stored);
    const token = newSession(state, user);
    if (!verifiedInDevelopment) outbox(state, "email-verification", input.email, { kind: "email-verification", url: `${process.env.VECTOR_APP_ORIGIN || "http://localhost:3000"}/workspace?verify=${verificationToken}` });
    audit(state, user, "", "account.created", "Account created and signed in.");
    return { user, token };
  });
}

export async function login(value: unknown): Promise<{ user: PilotUser; token: string }> {
  const input = credentials(value, false);
  await reserveAttempt("login", input.email);
  const state = await getPilotStore().read();
  const stored = state.users.find(user => user.email === input.email);
  const matches = await passwordMatches(input.password, stored?.passwordHash);
  if (!matches) {
    if (stored) await getPilotStore().mutate(next => audit(next, publicUser(stored), "", "auth.failed", "A sign-in attempt failed."));
    throw new PilotError(401, "Email or password is incorrect.");
  }
  return getPilotStore().mutate(next => {
    const current = next.users.find(user => user.id === stored!.id);
    if (!current || current.passwordHash !== stored!.passwordHash) throw new PilotError(401, "Email or password is incorrect.");
    const user = publicUser(current);
    const token = newSession(next, user);
    audit(next, user, "", "auth.login", "Signed in with a new private session.");
    return { user, token };
  });
}

export async function logout(token?: string): Promise<void> {
  await getPilotStore().mutate(state => {
    const user = sessionUser(state, token);
    if (token) state.sessions = state.sessions.filter(session => session.tokenHash !== sha256(token));
    if (user) audit(state, user, "", "auth.logout", "Signed out and invalidated this session.");
  });
}

export async function logoutAll(token?: string): Promise<void> {
  await getPilotStore().mutate(state => {
    const user = sessionUser(state, token);
    if (!user) throw new PilotError(401, "Sign in to continue.");
    state.sessions = state.sessions.filter(session => session.userId !== user.id);
    audit(state, user, "", "auth.logout-all", "All private sessions were invalidated.");
  });
}

export async function createInvitation(value: unknown, sessionToken?: string): Promise<{ email: string; token: string; expiresAt: string }> {
  const input = actionObject(value);
  if (Object.keys(input).some(name => !["email", "role"].includes(name))) throw new PilotError(400, "The request contains unsupported fields.");
  const email = normalizedActionEmail(input.email);
  if (!email) throw new PilotError(400, "Enter a valid email address.");
  const role = input.role === undefined ? "member" : input.role;
  if (role !== "member") throw new PilotError(400, "Only member invitations can be created from the application.");
  const state = await getPilotStore().read();
  const actor = requireUser(state, sessionToken);
  const storedActor = state.users.find(user => user.id === actor.id);
  if (storedActor?.role !== "admin") throw new PilotError(403, "Only workspace administrators can create invitations.");
  const invitationToken = createToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await getPilotStore().mutate(next => {
    const currentActor = requireUser(next, sessionToken);
    const currentStoredActor = next.users.find(user => user.id === currentActor.id);
    if (currentStoredActor?.role !== "admin") throw new PilotError(403, "Only workspace administrators can create invitations.");
    if (next.users.some(user => user.email === email)) throw new PilotError(409, "That email already has an account.");
    next.invitations = next.invitations.filter(invitation => !(invitation.email === email && !invitation.usedAt));
    next.invitations.push({ id: randomUUID(), email, tokenHash: sha256(invitationToken), role: "member", createdAt: new Date().toISOString(), expiresAt });
    outbox(next, "invitation", email, { kind: "invitation", url: `${process.env.VECTOR_APP_ORIGIN || "http://localhost:3000"}/workspace?invite=${invitationToken}`, inviter: currentActor.name });
    audit(next, actor, "", "invitation.created", `Invitation created for ${email}.`);
  });
  return { email, token: invitationToken, expiresAt };
}

function tokenName(value: unknown): string {
  const input = actionObject(value);
  if (Object.keys(input).some(name => name !== "name") || typeof input.name !== "string" || !input.name.trim() || input.name.length > 100 || input.name.includes("\0")) throw new PilotError(400, "Give the API token a name of up to 100 characters.", { name: "Use a descriptive token name." });
  return input.name.trim();
}

export async function createApiToken(value: unknown, sessionToken?: string): Promise<{ id: string; name: string; prefix: string; token: string; createdAt: string }> {
  const name = tokenName(value);
  const state = await getPilotStore().read();
  const user = requireUser(state, sessionToken);
  const raw = `vec_${createToken()}`;
  const createdAt = new Date().toISOString();
  const token = { id: randomUUID(), userId: user.id, name, tokenHash: sha256(raw), prefix: raw.slice(0, 12), createdAt };
  await getPilotStore().mutate(next => {
    const current = requireUser(next, sessionToken);
    next.apiTokens.push({ ...token, userId: current.id });
    audit(next, current, "", "auth.api-token-created", `API token created: ${name}.`);
  });
  return { id: token.id, name: token.name, prefix: token.prefix, token: raw, createdAt };
}

export async function listApiTokens(sessionToken?: string): Promise<{ tokens: Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }> }> {
  const state = await getPilotStore().read();
  const user = requireUser(state, sessionToken);
  return { tokens: state.apiTokens.filter(token => token.userId === user.id).map(({ id, name, prefix, createdAt, lastUsedAt, revokedAt }) => ({ id, name, prefix, createdAt, ...(lastUsedAt ? { lastUsedAt } : {}), ...(revokedAt ? { revokedAt } : {}) })) };
}

export async function revokeApiToken(value: unknown, sessionToken?: string): Promise<{ revoked: true }> {
  const input = actionObject(value);
  if (Object.keys(input).some(name => name !== "id") || typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.id)) throw new PilotError(400, "The API token identifier is invalid.");
  const state = await getPilotStore().read();
  const user = requireUser(state, sessionToken);
  return getPilotStore().mutate(next => {
    const current = requireUser(next, sessionToken);
    const token = next.apiTokens.find(candidate => candidate.id === input.id && candidate.userId === user.id);
    if (!token) throw new PilotError(404, "API token not found.");
    if (!token.revokedAt) token.revokedAt = new Date().toISOString();
    audit(next, current, "", "auth.api-token-revoked", `API token revoked: ${token.name}.`);
    return { revoked: true as const };
  });
}

export async function verifyEmail(value: unknown): Promise<{ user: PilotUser }> {
  const raw = actionToken(value, "token");
  return getPilotStore().mutate(state => {
    const user = state.users.find(item => item.emailVerificationTokenHash === sha256(raw) && !!item.emailVerificationExpiresAt && Date.parse(item.emailVerificationExpiresAt) > Date.now());
    if (!user) throw new PilotError(400, "The verification link is invalid or expired.");
    user.emailVerifiedAt = new Date().toISOString();
    delete user.emailVerificationTokenHash;
    delete user.emailVerificationExpiresAt;
    delete user.emailVerificationSentAt;
    const publicAccount = publicUser(user);
    audit(state, publicAccount, "", "account.email-verified", "Email address verified.");
    return { user: publicAccount };
  });
}

export async function resendVerification(sessionToken?: string): Promise<{ message: string }> {
  const state = await getPilotStore().read();
  const user = sessionUser(state, sessionToken);
  if (!user) throw new PilotError(401, "Sign in to continue.");
  return getPilotStore().mutate(next => {
    const current = next.users.find(item => item.id === user.id);
    if (!current) throw new PilotError(401, "Sign in to continue.");
    if (current.emailVerifiedAt) return { message: "Your email address is already verified." };
    const now = Date.now();
    if (current.emailVerificationSentAt && Date.parse(current.emailVerificationSentAt) > now - 60_000) {
      throw new PilotError(429, "A verification email was sent recently. Check your inbox before requesting another.", undefined, Math.max(1, Math.ceil((Date.parse(current.emailVerificationSentAt) + 60_000 - now) / 1000)));
    }
    const token = createToken();
    current.emailVerificationTokenHash = sha256(token);
    current.emailVerificationExpiresAt = new Date(now + TOKEN_SECONDS * 1000).toISOString();
    current.emailVerificationSentAt = new Date(now).toISOString();
    outbox(next, "email-verification", current.email, { kind: "email-verification", url: `${process.env.VECTOR_APP_ORIGIN || "http://localhost:3000"}/workspace?verify=${token}` });
    return { message: "A new verification email is on its way." };
  });
}

export async function e2eMailbox(emailValue: string | null): Promise<{ messages: Array<{ type: OutboxMessage["type"]; url: string }> }> {
  if (process.env.VECTOR_E2E_MODE !== "true" || process.env.VECTOR_ALLOW_JSON_TEST_STORAGE !== "true") throw new PilotError(404, "Endpoint not found.");
  const email = normalizedActionEmail(emailValue);
  if (!email) throw new PilotError(400, "Enter a valid email address.");
  const state = await getPilotStore().read();
  const messages = state.outbox.filter(message => message.to === email && !message.sentAt).map(message => {
    const payload = openOutboxPayload(message.payload.encrypted || "");
    return { type: message.type, url: payload.url };
  }).filter(message => !!message.url);
  return { messages };
}

export async function forgotPassword(value: unknown): Promise<{ message: string }> {
  const email = actionEmail(value);
  await getPilotStore().mutate(state => {
    const user = state.users.find(item => item.email === email);
    if (!user) return;
    const resetToken = createToken();
    user.passwordResetTokenHash = sha256(resetToken);
    user.passwordResetExpiresAt = new Date(Date.now() + TOKEN_SECONDS * 1000).toISOString();
    outbox(state, "password-reset", email, { kind: "password-reset", url: `${process.env.VECTOR_APP_ORIGIN || "http://localhost:3000"}/workspace?reset=${resetToken}` });
  });
  return { message: "If the account is eligible, a recovery email will be sent." };
}

export async function resetPassword(value: unknown): Promise<{ user: PilotUser }> {
  const input = actionPassword(value);
  const passwordHash = await hashPassword(input.password);
  return getPilotStore().mutate(state => {
    const user = state.users.find(item => item.passwordResetTokenHash === sha256(input.token) && !!item.passwordResetExpiresAt && Date.parse(item.passwordResetExpiresAt) > Date.now());
    if (!user) throw new PilotError(400, "The reset link is invalid or expired.");
    user.passwordHash = passwordHash;
    delete user.passwordResetTokenHash;
    delete user.passwordResetExpiresAt;
    state.sessions = state.sessions.filter(session => session.userId !== user.id);
    state.apiTokens = state.apiTokens.map(apiToken => apiToken.userId === user.id && !apiToken.revokedAt ? { ...apiToken, revokedAt: new Date().toISOString() } : apiToken);
    const publicAccount = publicUser(user);
    audit(state, publicAccount, "", "auth.password-reset", "Password reset and all sessions invalidated.");
    return { user: publicAccount };
  });
}

export function sessionCookie(request: Request, token?: string): string {
  const secure = new URL(request.url).protocol === "https:" || (process.env.NODE_ENV === "production" && process.env.VECTOR_E2E_MODE !== "true");
  return `${SESSION_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSION_SECONDS : 0}${secure ? "; Secure" : ""}`;
}
