/** Stable error codes. The UI maps them to German text (see lib/messages.ts). */
export type DomainErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'ILLEGAL_TRANSITION'
  | 'EMPTY_ORDER'
  | 'ITEM_NOT_FROM_SUPPLIER'
  | 'ALREADY_SENT'
  | 'RECEIPT_CLOSED'
  | 'CLOSING_LOCKED'
  | 'TOO_LATE'
  | 'ROSTER_BLOCKED'
  | 'MAIL_FAILED';

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

export function domainError(code: DomainErrorCode, message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError(code, message, details);
}
