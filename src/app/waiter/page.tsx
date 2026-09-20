import { redirect } from 'next/navigation';
import { getWaiter } from '../../server/http/api';
import { WaiterDashboard } from '../../components/waiter/WaiterDashboard';

export const dynamic = 'force-dynamic';

export default async function WaiterHomePage() {
  // Every waiter surface re-checks authentication server-side. Middleware would
  // be a convenience, never the boundary.
  const user = await getWaiter();
  if (!user) redirect('/waiter/login');

  return <WaiterDashboard userName={user.displayName} />;
}
