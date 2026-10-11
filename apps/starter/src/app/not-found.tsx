import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="section container narrow">
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for doesn&apos;t exist or has moved.</p>
      <p>
        <Link href="/products" className="bx-button bx-button--primary">
          Browse products
        </Link>
      </p>
    </section>
  );
}
