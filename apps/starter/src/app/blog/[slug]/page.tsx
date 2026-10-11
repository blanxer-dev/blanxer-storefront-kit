import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getBlogPost } from '@blanxer-dev/storefront/server';
import { blogPostMetadata } from '@blanxer-dev/storefront/seo';
import { origin, slugParam, store } from '@/lib/site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [s, o, post] = await Promise.all([store(), origin(), getBlogPost(slugParam((await params).slug))]);
  if (!post) return { title: 'Post not found', robots: { index: false } };
  return blogPostMetadata(post, s, { origin: o });
}

export default async function BlogPost({ params }: Props) {
  const post = await getBlogPost(slugParam((await params).slug));
  if (!post) notFound();
  const date = post.published_at || post.created_at;
  return (
    <article className="section container narrow">
      <h1>{post.name}</h1>
      <p className="muted">
        {post.author?.name ? `${post.author.name} · ` : ''}
        {date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
      </p>
      {post.featured_image ? (
        <div className="post-media">
          <Image src={post.featured_image} alt={post.name} fill preload sizes="(max-width: 760px) 100vw, 760px" />
        </div>
      ) : null}
      {post.excerpt ? <p className="prose">{post.excerpt}</p> : null}
      {/* Posts are made of Blanxer page-builder sections. The starter renders the rich-text ones
          (`rte`) in order; render other section types (images, product grids…) as your design needs. */}
      {((post.sections || []) as Array<{ n: string; o?: number; d?: { text?: string } }>)
        .filter((sec) => sec.n === 'rte' && sec.d?.text)
        .sort((a, b) => (a.o ?? 0) - (b.o ?? 0))
        .map((sec, i) => (
          <div key={i} className="prose" dangerouslySetInnerHTML={{ __html: sec.d!.text! }} />
        ))}
    </article>
  );
}
