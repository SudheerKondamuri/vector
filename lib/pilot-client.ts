import type { PilotApiError } from "./pilot-types";

export class PilotRequestError extends Error {
  constructor(message: string, public status: number, public fields: Record<string, string> = {}) {
    super(message);
    this.name = "PilotRequestError";
  }
}

export async function pilotRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/pilot${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    const error = data as PilotApiError;
    throw new PilotRequestError(error.error || "The request could not be completed.", response.status, error.fields);
  }
  return data as T;
}

export const jsonBody = (data: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(data) });
