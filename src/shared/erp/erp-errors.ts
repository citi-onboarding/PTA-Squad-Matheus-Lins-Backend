/** How an ERP call failed; drives whether and how it is retried. */
export type ErpErrorKind = "http" | "network" | "timeout" | "malformed";

export interface ErpProblemIssue {
  campo: string;
  mensagem: string;
}

export interface ErpRequestErrorOptions {
  kind: ErpErrorKind;
  status?: number | undefined;
  detail?: string | undefined;
  erros?: ErpProblemIssue[] | undefined;
  retryAfterSeconds?: number | undefined;
}

/**
 * A failed ERP call. Carries only the status and the Problem `detail`/`erros`;
 * never the API key, headers, or raw response body (RN-14).
 */
export class ErpRequestError extends Error {
  readonly kind: ErpErrorKind;
  readonly status: number | undefined;
  readonly detail: string | undefined;
  readonly erros: ErpProblemIssue[];
  readonly retryAfterSeconds: number | undefined;

  constructor(options: ErpRequestErrorOptions) {
    super(`ERP request failed (${options.kind}).`);
    this.name = "ErpRequestError";
    this.kind = options.kind;
    this.status = options.status;
    this.detail = options.detail;
    this.erros = options.erros ?? [];
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** The ERP asked to wait longer than a caller should block (e.g. daily limit). */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("ERP rate limit reached.");
    this.name = "RateLimitedError";
  }
}
