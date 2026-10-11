import { CartView } from '@blanxer/storefront/react';
import { noIndexMetadata } from '@blanxer/storefront/seo';

export const metadata = noIndexMetadata('Cart');

export default function CartPage() {
  return (
    <section className="section container narrow">
      <h1>Cart</h1>
      {/* Ticked lines are what checkout orders (same as the Blanxer storefront). */}
      <CartView checkoutHref="/checkout" continueHref="/products" />
    </section>
  );
}
