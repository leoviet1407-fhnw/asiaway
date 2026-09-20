/**
 * Stable, machine-readable error codes. The HTTP layer maps these to status
 * codes; the UI maps them to localised text. Messages here are for logs and
 * developers, never shown raw to a guest.
 */
export type DomainErrorCode =
  | 'QR_INVALID'
  | 'SESSION_CLOSED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_OPEN'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_EDITABLE'
  /** The guest's 60-second window has closed; only staff can change it now. */
  | 'ORDER_WINDOW_CLOSED'
  /** This device has no claim on the order it is trying to change. */
  | 'FORBIDDEN'
  | 'ILLEGAL_ORDER_TRANSITION'
  | 'ILLEGAL_SESSION_TRANSITION'
  | 'ITEMS_UNAVAILABLE'
  | 'EMPTY_CART'
  | 'CART_TOO_LARGE'
  | 'INVALID_QUANTITY'
  | 'NOTE_TOO_LONG'
  | 'REVISION_CONFLICT'
  | 'REQUEST_IN_FLIGHT'
  | 'SESSION_HAS_UNRESOLVED_ORDERS'
  | 'REASON_REQUIRED'
  /* Workforce planning (B1). */
  | 'INVALID_PENSUM'
  | 'INVALID_WORK_TIME_POLICY'
  | 'INVALID_PERIOD'
  | 'VALIDATION_FAILED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function domainError(
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError(code, message, details);
}
