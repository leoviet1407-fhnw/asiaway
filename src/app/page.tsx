/**
 * The bare domain is not a guest entry point: guests always arrive through a
 * table QR. This page exists so someone typing the address gets a useful answer
 * instead of a 404.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Asiaway</h1>
      <p className="text-ink-muted">
        Please scan the QR code on your table to see the menu and order.
      </p>
      <a href="/waiter" className="btn-secondary mt-4">
        Staff sign in
      </a>
    </main>
  );
}
