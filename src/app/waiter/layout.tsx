export const dynamic = 'force-dynamic';

export default function WaiterLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-surface-sunken">{children}</div>;
}
