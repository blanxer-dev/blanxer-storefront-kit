import { PaymentFailed } from '@blanxer-dev/storefront/react';
import { noIndexMetadata } from '@blanxer-dev/storefront/seo';

export const metadata = noIndexMetadata('Payment failed');

/** Required route: gateways return here when a payment fails or is cancelled. */
export default async function PaymentFailedPage({ searchParams }: { searchParams: Promise<{ method?: string; order?: string }> }) {
  // `order`: the gateway sends it back (e.g. an eSewa cancel) so the shopper can pay that order again
  const { method, order } = await searchParams;
  return (
    <div className="container narrow">
      <PaymentFailed method={method} order={order} homeHref="/products" />
    </div>
  );
}
