/** An error answer from Crystal: carries the HTTP status and what Crystal said. */
export class CrystalAPIError extends Error {
  /** The HTTP status Crystal answered with. */
  readonly status: number;
  /** The request's method. */
  readonly method: string;
  /** The request's path. */
  readonly path: string;
  constructor(status: number, message: string, method: string, path: string) {
    super(`${method} ${path} → ${status}: ${message}`);
    this.name = "CrystalAPIError";
    this.status = status;
    this.method = method;
    this.path = path;
  }
  /** The bot isn't allowed to do this here (missing permission, scope, or the person who authorised it lost theirs). */
  get isForbidden() {
    return this.status === 403;
  }
  /** What was asked for doesn't exist (404). */
  get isNotFound() {
    return this.status === 404;
  }
  /** Crystal said to slow down (429), and retrying didn't help. */
  get isRateLimited() {
    return this.status === 429;
  }
}

/** Something about how the SDK was used, rather than something Crystal said. */
export class CrystalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrystalError";
  }
}
