import { OrderTracking } from '@blanxer/storefront/react';
import { noIndexMetadata } from '@blanxer/storefront/seo';

export const metadata = noIndexMetadata('Track your order');

/** Required route: COD and paid QR orders land here; order SMS and emails link here. Cancel and review by phone number, no login. */
export default async function TrackPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  return (
    <div className="container narrow">
      <OrderTracking orderId={id} fromCheckout={from === 'checkout'} />
    </div>
  );
}
