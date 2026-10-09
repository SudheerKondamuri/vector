import nodemailer from "nodemailer";
import type { OutboxMessage } from "../pilot-server/store.ts";
import { getPilotStore } from "../pilot-server/store.ts";
import { openOutboxPayload } from "../pilot-server/auth.ts";

function subject(type: OutboxMessage["type"]): string {
  return type === "invitation" ? "Your Vector invitation" : type === "password-reset" ? "Reset your Vector password" : "Verify your Vector email";
}

function body(type: OutboxMessage["type"], payload: Record<string, string>): string {
  const url = payload.url;
  if (!url) throw new Error("Email payload has no action URL");
  if (type === "invitation") return `You were invited to Vector by ${payload.inviter || "a workspace sponsor"}. Open this link to create your account:\n\n${url}\n\nThis invitation expires in seven days.`;
  if (type === "password-reset") return `Use this link to reset your Vector password:\n\n${url}\n\nIf you did not request this, you can ignore this message.`;
  return `Verify your Vector email address here:\n\n${url}\n\nThis link expires in one hour.`;
}

async function send(message: OutboxMessage): Promise<void> {
  const payload = openOutboxPayload(message.payload.encrypted || "");
  const provider = process.env.EMAIL_PROVIDER || "log";
  if (provider === "log") {
    process.stdout.write(JSON.stringify({ event: "email-delivery-simulated", type: message.type, to: message.to }) + "\n");
    return;
  }
  if (provider !== "smtp") throw new Error("EMAIL_PROVIDER must be smtp or log");
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.EMAIL_FROM;
  if (!host || !Number.isInteger(port) || !user || !password || !from) throw new Error("SMTP email configuration is incomplete");
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass: password } });
  await transport.sendMail({ from, to: message.to, subject: subject(message.type), text: body(message.type, payload) });
}

export async function drainOneOutbox(workerId: string): Promise<boolean> {
  const message = await getPilotStore().mutate(state => {
    const now = Date.now();
    const found = state.outbox.find(candidate => !candidate.sentAt && candidate.attempts < 10 && (!candidate.lockedAt || Date.parse(candidate.lockedAt) < now - 5 * 60_000));
    if (!found) return null;
    found.lockedBy = workerId;
    found.lockedAt = new Date(now).toISOString();
    found.attempts += 1;
    found.errorMessage = undefined;
    return { ...found };
  });
  if (!message) return false;
  try {
    await send(message);
    await getPilotStore().mutate(state => {
      const current = state.outbox.find(candidate => candidate.id === message.id && candidate.lockedBy === workerId);
      if (current) { current.sentAt = new Date().toISOString(); current.lockedBy = undefined; current.lockedAt = undefined; }
    });
  } catch (error) {
    await getPilotStore().mutate(state => {
      const current = state.outbox.find(candidate => candidate.id === message.id && candidate.lockedBy === workerId);
      if (current) { current.lockedBy = undefined; current.lockedAt = undefined; current.errorMessage = (error instanceof Error ? error.message : "Email delivery failed").slice(0, 4000); }
    });
  }
  return true;
}
