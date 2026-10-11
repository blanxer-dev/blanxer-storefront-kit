import { PaymentSuccess } from '@blanxer-dev/storefront/react';
import { noIndexMetadata } from '@blanxer-dev/storefront/seo';

export const metadata = noIndexMetadata('Payment successful');

/** Required route: gateways and the QR screens return here after a paid order. */
export default function PaymentSuccessPage() {
  return (
    <div className="container narrow">
      <PaymentSuccess />
    </div>
  );
}
