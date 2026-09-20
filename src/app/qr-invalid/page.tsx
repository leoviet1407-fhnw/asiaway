/**
 * Shown when a QR code is unknown, retired or deactivated.
 *
 * Says nothing about which tables exist or why the code failed: a guest just
 * needs to know to ask a member of staff.
 */
export default function QrInvalidPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">This code is not active</h1>
      <p className="text-ink-muted">Please ask a member of our team for help.</p>
      <p className="mt-4 text-sm text-ink-muted">
        Dieser Code ist nicht aktiv. Bitte wenden Sie sich an unser Team.
      </p>
      <p className="text-sm text-ink-muted">
        Mã này không hoạt động. Vui lòng hỏi nhân viên của chúng tôi.
      </p>
    </main>
  );
}
