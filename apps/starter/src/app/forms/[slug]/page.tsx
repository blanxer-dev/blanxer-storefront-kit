import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getForm } from '@blanxer/storefront/server';
import { BlanxerForm } from '@blanxer/storefront/react';
import { slugParam } from '@/lib/site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const form = await getForm(slugParam((await params).slug));
  return { title: form?.page_header || form?.title || form?.name || 'Form' };
}

/** Forms built in Blanxer (Forms in the dashboard). Submissions go from the browser. */
export default async function FormPage({ params }: Props) {
  const form = await getForm(slugParam((await params).slug));
  if (!form) notFound();
  return (
    <section className="section container narrow">
      <h1>{form.page_header || form.title || form.name}</h1>
      {form.page_subheader ? <p className="muted">{form.page_subheader}</p> : null}
      {form.description ? <p className="muted">{form.description}</p> : null}
      <BlanxerForm form={form} />
    </section>
  );
}
