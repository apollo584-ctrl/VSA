export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Network failure / backend not reachable (as opposed to a well-formed error response). */
  get isUnavailable(): boolean {
    return this.code === "unavailable" || this.status >= 502;
  }

  get isInvalid(): boolean {
    return this.code === "invalid_response";
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError("unknown", e instanceof Error ? e.message : "Unknown error");
}

export const NO_PIN_DETAIL = /no pin is set/i;

function waitText(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 90) return `${s} seconds`;
  const m = Math.ceil(s / 60);
  return `${m} minutes`;
}

/** Plain-language text for a failed unlock attempt. */
export function authErrorMessage(e: unknown): string {
  const err = toApiError(e);
  if (err.status === 429) {
    const ra = (err.details as { retryAfter?: number } | undefined)?.retryAfter;
    return ra ? `Too many attempts. Try again in ${waitText(ra)}.` : "Too many attempts. Try again later.";
  }
  if (err.code === "unauthorized") {
    return NO_PIN_DETAIL.test(err.message) ? "No PIN is set on the host PC. On that PC run set_pin (see backend README)." : "Wrong PIN";
  }
  if (err.isUnavailable) return "The analysis service could not be reached.";
  return err.message;
}
