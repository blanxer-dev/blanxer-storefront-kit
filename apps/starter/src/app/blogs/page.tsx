import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getBlogPosts } from '@blanxer/storefront/server';

export const metadata: Metadata = { title: 'Blog' };

type Props = { searchParams: Promise<{ category?: string; cursor?: string }> };

export default async function Blogs({ searchParams }: Props) {
  const { category, cursor } = await searchParams;
  const res = await getBlogPosts({ category, cursor });
  const categories = res.all_categories || [];
  return (
    <section className="section container">
      <h1>Blog</h1>
      {categories.length ? (
        <nav className="chips" aria-label="Blog categories">
          <Link href="/blogs" aria-current={!category ? 'true' : undefined}>
            All
          </Link>
          {categories.map((c) => (
            <Link key={c.slug} href={`/blogs?category=${encodeURIComponent(c.slug)}`} aria-current={category === c.slug ? 'true' : undefined}>
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {res.items.length ? (
        <div className="posts">
          {res.items.map((p: any, i: number) => (
            <Link key={p._id} href={`/blog/${p.slug}`} className="post">
              {p.featured_image ? (
                <span className="post-media">
                  <Image src={p.featured_image} alt={p.name} fill sizes="(max-width: 640px) 100vw, 380px" loading={i < 3 ? 'eager' : undefined} fetchPriority={i === 0 ? 'high' : undefined} />
                </span>
              ) : null}
              <strong>{p.name}</strong>
              {p.excerpt ? <span className="muted">{p.excerpt}</span> : null}
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">No posts yet.</p>
      )}
      {res.next_cursor ? (
        <nav className="pagination">
          <span />
          <Link href={`/blogs?${new URLSearchParams({ ...(category ? { category } : {}), cursor: res.next_cursor })}`}>Older posts →</Link>
        </nav>
      ) : null}
    </section>
  );
}
