import { CustomerProvider } from '../../components/customer/CustomerProvider';
import { Shell } from '../../components/customer/Shell';

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerProvider>
      <Shell>{children}</Shell>
    </CustomerProvider>
  );
}
