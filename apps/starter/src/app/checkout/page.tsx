import { getDeliveryCharges } from '@blanxer-dev/storefront/server';
import { Checkout } from '@blanxer-dev/storefront/react';
import { noIndexMetadata } from '@blanxer-dev/storefront/seo';

export const metadata = noIndexMetadata('Checkout');

/**
 * Required route. The package's Checkout is Blanxer's checkout: fields,
 * delivery charges, coupons, every payment method, QR holds. Restyle it with
 * CSS (bx-* classes, --bx-* variables), `labels`, `header`/`footer` — never
 * rewrite it. Its "Checkout Powered by Blanxer" line stays.
 */
export default async function CheckoutPage() {
  const delivery = await getDeliveryCharges();
  return (
    <div className="container">
      <Checkout delivery={delivery} />
    </div>
  );
}
