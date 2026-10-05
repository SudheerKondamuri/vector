export class PilotError extends Error {
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly retryAfter?: number;

  constructor(status: number, message: string, fields?: Record<string, string>, retryAfter?: number) {
    super(message);
    this.name = "PilotError";
    this.status = status;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

export function unavailable(): PilotError {
  return new PilotError(503, "Pilot storage is unavailable. Restore or repair the private data file before continuing.");
}
