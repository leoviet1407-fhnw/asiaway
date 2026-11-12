export const metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="mt-16 text-2xl">Keine Verbindung</h1>
      <p className="mt-3">
        Das Telefon ist gerade offline. Begonnene Wareneingänge bleiben auf dem Gerät gespeichert und werden gesendet, sobald
        die Verbindung zurück ist.
      </p>
      <a href="/" className="btn-primary mt-6">
        Nochmals versuchen
      </a>
    </main>
  );
}
