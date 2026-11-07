import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPostBySlug, readingMinutes, renderMarkdown, siteUrl } from '@/lib/posts';
import '../blog.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return { title: 'Not found', robots: { index: false } };

  const url = `${siteUrl()}/blog/${post.slug}`;
  const title = post.seo_title || post.title;
  const description = post.seo_description || post.excerpt || undefined;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title,
      description,
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at,
      authors: [post.author],
      images: post.cover_image ? [post.cover_image] : undefined,
      tags: post.tags,
    },
    twitter: {
      card: post.cover_image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: post.cover_image ? [post.cover_image] : undefined,
    },
  };
}

function fmt(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const html = renderMarkdown(post.body_md);
  const url = `${siteUrl()}/blog/${post.slug}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seo_description || post.excerpt || undefined,
    image: post.cover_image || undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: { '@type': 'Organization', name: post.author },
    publisher: { '@type': 'Organization', name: 'Revenue Express', url: siteUrl() },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    keywords: post.tags.join(', '),
  };

  return (
    <div className="blog">
      <div className="brand-bg" aria-hidden="true" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="blog-nav">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-mark.png" alt="" width={1106} height={754} />
          <span className="name">Revenue<em>Express</em></span>
        </Link>
        <div className="links">
          <Link href="/">Home</Link>
          <Link href="/blog" data-active="true">Blog</Link>
          <Link href="/#contact" className="blog-cta">Book a Call</Link>
        </div>
      </nav>

      <article className="post">
        <Link href="/blog" className="post-back">← All posts</Link>

        {post.tags.length > 0 && (
          <div className="blog-tags">
            {post.tags.map(tag => <span className="blog-tag" key={tag}>{tag}</span>)}
          </div>
        )}

        <h1>{post.title}</h1>
        {post.excerpt && <p className="post-lead">{post.excerpt}</p>}

        <div className="blog-meta">
          <span>{post.author}</span>
          <span>|</span>
          <span>{fmt(post.published_at)}</span>
          <span>|</span>
          <span>{readingMinutes(post.body_md)} min read</span>
        </div>

        {post.cover_image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="post-cover" src={post.cover_image} alt={post.cover_alt || post.title} />
        )}

        {/* Markdown is rendered and sanitised server-side in lib/posts.ts. */}
        <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />
      </article>

      <footer className="blog-foot">
        <span>© {new Date().getFullYear()} Revenue Express</span>
        <Link href="/">revenueexpress.com</Link>
      </footer>
    </div>
  );
}
