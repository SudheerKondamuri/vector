import { accessToken, createApiToken, createInvitation, e2eMailbox, forgotPassword, listApiTokens, login, logout, logoutAll, register, resendVerification, resetPassword, revokeApiToken, sessionCookie, sessionUser, touchApiToken, verifyEmail } from "./auth";
import { PilotError } from "./errors";
import { getPilotStore } from "./store";
import { archiveTask, createSubmission, createTask, editTask, exportTask, getProfile, getTask, listTasks, marketplaceProfiles, marketplaceTasks, openChallenge, publishTask, recordReport, referenceBundle, releaseTaskReservation, reserveTask, resolveChallenge, reviewSubmission, submissionArtifact, updateLedger, updateProfile, verifySubmission } from "./service";
import { createEscrowIntent, getEscrow, recordChallengeResolution, recordChallengeTransaction, recordFinalization, recordFunding, recordReleaseRequest } from "./settlement";
import { object, onlyKeys } from "./validation";

export const MAX_REQUEST_BYTES = 512 * 1024;
const securityHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  vary: "Cookie",
};

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...securityHeaders, "content-type": "application/json; charset=utf-8", ...headers } });
}

function attachment(content: string, type: string, filename: string): Response {
  return new Response(content, { headers: { ...securityHeaders, "content-type": type, "content-disposition": `attachment; filename="${filename}"` } });
}

function mutationBoundary(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next may normalize request.url to localhost. Host retains the browser's real authority.
  // A deployed reverse proxy must explicitly configure its canonical origin, not rely on forwarded headers.
  let expectedOrigin = process.env.VECTOR_APP_ORIGIN;
  try {
    if (expectedOrigin) {
      const configured = new URL(expectedOrigin);
      if (!['http:', 'https:'].includes(configured.protocol) || configured.origin !== expectedOrigin) throw new Error("Invalid canonical origin");
    } else {
      const authority = request.headers.get("host") ?? url.host;
      const actual = new URL(`${url.protocol}//${authority}`);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(actual.hostname) || actual.host !== authority || actual.pathname !== "/" || actual.username || actual.password) throw new Error("Unconfigured host");
      expectedOrigin = actual.origin;
    }
  } catch { throw new PilotError(403, "This host is not configured for the private pilot application."); }
  if (!origin || origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") throw new PilotError(403, "Mutations require a same-origin request.");
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new PilotError(415, "Mutations require Content-Type: application/json.");
}

async function body(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) throw new PilotError(413, "The request exceeds the 512 KiB payload limit.");
  if (!request.body) return {};
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new PilotError(413, "The request exceeds the 512 KiB payload limit.");
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  if (!size) return {};
  const content = Buffer.concat(chunks, size);
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return JSON.parse(raw);
  } catch { throw new PilotError(400, "Provide valid UTF-8 JSON."); }
}

function empty(value: unknown): void { onlyKeys(object(value), []); }

function supportedMethod(request: Request, methods: string[]): void {
  if (!methods.includes(request.method)) throw new PilotError(405, "This method is not supported for the requested endpoint.");
}

/** Framework-independent request entry point, exercised against isolated storage in tests. */
export async function handlePilotRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/pilot/")) throw new PilotError(404, "Endpoint not found.");
    const parts = url.pathname.slice("/api/pilot/".length).replace(/\/$/, "").split("/");
    if (parts.some(part => !/^[a-zA-Z0-9_-]+$/.test(part))) throw new PilotError(404, "Endpoint not found.");
    const path = parts.join("/");
    const token = accessToken(request);
    await touchApiToken(token);
    let value: unknown;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      mutationBoundary(request);
      value = await body(request);
    }

    if (path === "auth") {
      supportedMethod(request, ["GET"]);
      const state = await getPilotStore().read();
      return json({ user: sessionUser(state, token) });
    }
    if (path === "auth/register" || path === "auth/login") {
      supportedMethod(request, ["POST"]);
      const result = path === "auth/register" ? await register(value) : await login(value);
      return json({ user: result.user }, path === "auth/register" ? 201 : 200, { "set-cookie": sessionCookie(request, result.token) });
    }
    if (path === "auth/logout") {
      supportedMethod(request, ["POST"]);
      empty(value);
      await logout(token);
      return json({ user: null }, 200, { "set-cookie": sessionCookie(request) });
    }
    if (path === "auth/logout-all") {
      supportedMethod(request, ["POST"]);
      empty(value);
      await logoutAll(token);
      return json({ user: null }, 200, { "set-cookie": sessionCookie(request) });
    }
    if (path === "auth/verify-email") {
      supportedMethod(request, ["POST"]);
      return json(await verifyEmail(value));
    }
    if (path === "auth/resend-verification") {
      supportedMethod(request, ["POST"]);
      empty(value);
      return json(await resendVerification(token));
    }
    if (path === "auth/e2e-mailbox") {
      supportedMethod(request, ["GET"]);
      return json(await e2eMailbox(url.searchParams.get("email")));
    }
    if (path === "auth/api-tokens") {
      supportedMethod(request, ["GET", "POST"]);
      return request.method === "GET" ? json(await listApiTokens(token)) : json(await createApiToken(value, token), 201);
    }
    if (parts[0] === "auth" && parts[1] === "api-tokens" && parts.length === 3) {
      supportedMethod(request, ["POST"]);
      return json(await revokeApiToken({ id: parts[2] }, token));
    }
    if (path === "auth/forgot-password") {
      supportedMethod(request, ["POST"]);
      return json(await forgotPassword(value));
    }
    if (path === "auth/reset-password") {
      supportedMethod(request, ["POST"]);
      return json(await resetPassword(value));
    }
    if (path === "auth/invitations") {
      supportedMethod(request, ["POST"]);
      return json(await createInvitation(value, token), 201);
    }
    if (path === "reference") {
      supportedMethod(request, ["GET"]);
      return json(referenceBundle());
    }
    if (path === "profile") {
      supportedMethod(request, ["GET", "PATCH"]);
      return request.method === "GET" ? json({ profile: await getProfile(token) }) : json({ profile: await updateProfile(value, token) });
    }
    if (path === "marketplace/tasks") {
      supportedMethod(request, ["GET"]);
      return json(await marketplaceTasks(url.searchParams.get("q") || "", token));
    }
    if (path === "marketplace/profiles") {
      supportedMethod(request, ["GET"]);
      return json(await marketplaceProfiles(url.searchParams.get("q") || "", token));
    }
    if (path === "tasks") {
      supportedMethod(request, ["GET", "POST"]);
      return request.method === "GET" ? json(await listTasks(token)) : json({ task: await createTask(value, token) }, 201);
    }
    if (parts[0] === "tasks" && parts.length === 2) {
      supportedMethod(request, ["GET", "PATCH"]);
      return request.method === "GET" ? json(await getTask(parts[1], token)) : json({ task: await editTask(parts[1], value, token) });
    }
    if (parts[0] === "tasks" && parts.length === 3) {
      const id = parts[1];
      if (parts[2] === "publish" || parts[2] === "archive") {
        supportedMethod(request, ["POST"]);
        empty(value);
        return json({ task: parts[2] === "publish" ? await publishTask(id, token) : await archiveTask(id, token) });
      }
      if (parts[2] === "ledger") {
        supportedMethod(request, ["PATCH"]);
        return json({ task: await updateLedger(id, value, token) });
      }
      if (parts[2] === "reserve" || parts[2] === "release-reservation") {
        supportedMethod(request, ["POST"]);
        empty(value);
        return json(parts[2] === "reserve" ? { reservation: await reserveTask(id, token) } : await releaseTaskReservation(id, token));
      }
      if (parts[2] === "escrow-intent") {
        supportedMethod(request, ["POST"]);
        return json({ escrow: await createEscrowIntent(id, value, token) }, 201);
      }
      if (parts[2] === "submissions") {
        supportedMethod(request, ["POST"]);
        return json({ submission: await createSubmission(id, value, token) }, 201);
      }
      if (parts[2] === "export") {
        supportedMethod(request, ["GET"]);
        const result = await exportTask(id, url.searchParams.get("format") ?? "json", token);
        return attachment(result.content, result.type, result.filename);
      }
    }
    if (parts[0] === "escrows" && parts.length === 2) {
      supportedMethod(request, ["GET"]);
      return json({ escrow: await getEscrow(parts[1], token) });
    }
    if (parts[0] === "escrows" && parts.length === 3) {
      supportedMethod(request, ["POST"]);
      if (parts[2] === "funding") return json({ escrow: await recordFunding(parts[1], value, token) });
      if (parts[2] === "release-request") return json({ escrow: await recordReleaseRequest(parts[1], value, token) });
      if (parts[2] === "challenge") return json({ escrow: await recordChallengeTransaction(parts[1], value, token) });
      if (parts[2] === "finalize") return json({ escrow: await recordFinalization(parts[1], value, token) });
      if (parts[2] === "resolve-challenge") return json({ escrow: await recordChallengeResolution(parts[1], value, url.searchParams.get("releaseToOperator") === "true", token) });
    }
    if (parts[0] === "submissions" && parts.length === 3) {
      const id = parts[1];
      if (parts[2] === "artifact") {
        supportedMethod(request, ["GET"]);
        const result = await submissionArtifact(id, token);
        return attachment(result.patch, "text/x-diff; charset=utf-8", result.filename);
      }
       if (["verify", "report", "review", "challenge"].includes(parts[2])) {
         supportedMethod(request, ["POST"]);
         if (parts[2] === "verify") { empty(value); return json({ submission: await verifySubmission(id, token) }); }
         if (parts[2] === "report") return json({ submission: await recordReport(id, value, token) });
         if (parts[2] === "challenge") return json({ challenge: await openChallenge(id, value, token) }, 201);
         return json({ submission: await reviewSubmission(id, value, token) });
       }
     }
    if (parts[0] === "challenges" && parts.length === 3 && parts[2] === "resolve") {
      supportedMethod(request, ["POST"]);
      return json({ challenge: await resolveChallenge(parts[1], value, token) });
    }
    throw new PilotError(404, "Endpoint not found.");
  } catch (error) {
    if (error instanceof PilotError) return json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}) }, error.status, error.retryAfter ? { "retry-after": String(error.retryAfter) } : {});
    // Never expose filesystem paths, credentials, verifier output, stack traces or unknown exception messages.
    return json({ error: "The pilot request could not be completed. Please try again." }, 500);
  }
}
