import { jsonLd } from '@blanxer-dev/storefront/seo';

/** `<script type="application/ld+json">` for schema.org data from @blanxer-dev/storefront/seo. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
