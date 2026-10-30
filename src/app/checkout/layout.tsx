import { CustomerProvider } from '../../components/customer/CustomerProvider';
import { Shell } from '../../components/customer/Shell';
import { GUEST_VIEWPORT } from '../../config/viewport';

export const viewport = GUEST_VIEWPORT;

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerProvider>
      <Shell>{children}</Shell>
    </CustomerProvider>
  );
}
