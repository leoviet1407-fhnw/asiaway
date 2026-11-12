/** German text for the stable error codes. */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Bitte zuerst anmelden.',
  FORBIDDEN: 'Dafür fehlt die Berechtigung.',
  RATE_LIMITED: 'Zu viele Fehlversuche. Bitte in 15 Minuten nochmals versuchen.',
  NOT_FOUND: 'Nicht gefunden.',
  VALIDATION_FAILED: 'Eingabe ungültig.',
  ILLEGAL_TRANSITION: 'In diesem Status nicht möglich.',
  EMPTY_ORDER: 'Die Bestellung ist leer.',
  ITEM_NOT_FROM_SUPPLIER: 'Dieser Artikel ist nicht beim Lieferanten gelistet.',
  ALREADY_SENT: 'Diese Bestellung wurde bereits gesendet.',
  RECEIPT_CLOSED: 'Diese Lieferung ist bereits abgeschlossen.',
  MAIL_FAILED: 'Die E-Mail konnte nicht gesendet werden. Die Bestellung bleibt zur Prüfung.',
  INTERNAL_ERROR: 'Unerwarteter Fehler. Bitte nochmals versuchen.',
};

export function messageFor(code: string, fallback?: string): string {
  if (code === 'VALIDATION_FAILED' && fallback) return fallback;
  return MESSAGES[code] ?? fallback ?? MESSAGES.INTERNAL_ERROR!;
}
