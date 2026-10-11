import { jsonLd } from '@blanxer/storefront/seo';

/** `<script type="application/ld+json">` for schema.org data from @blanxer/storefront/seo. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
