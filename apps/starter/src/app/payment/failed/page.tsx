import { PaymentFailed } from '@blanxer/storefront/react';
import { noIndexMetadata } from '@blanxer/storefront/seo';

export const metadata = noIndexMetadata('Payment failed');

/** Required route: gateways return here when a payment fails or is cancelled. */
export default async function PaymentFailedPage({ searchParams }: { searchParams: Promise<{ method?: string }> }) {
  const { method } = await searchParams;
  return (
    <div className="container narrow">
      <PaymentFailed method={method} homeHref="/products" />
    </div>
  );
}
