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
