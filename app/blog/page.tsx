import Link from 'next/link';
import type { Metadata } from 'next';
import { listPosts, siteUrl } from '@/lib/posts';
import './blog.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The Revenue Express Blog — Creator commerce insights',
  description:
    'Strategy, trends, and insights from the frontlines of creator-led commerce, Meta advertising, and cross-platform distribution.',
  alternates: { canonical: siteUrl() + '/blog' },
  openGraph: {
    type: 'website',
    url: siteUrl() + '/blog',
    title: 'The Revenue Express Blog',
    description: 'Strategy, trends, and insights from the frontlines of creator commerce.',
  },
};

function fmt(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function BlogIndex() {
  const posts = await listPosts({ status: 'published' });

  // Tells search engines this is a blog and lists its posts, which is what
  // earns the richer result treatment.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'The Revenue Express Blog',
    url: siteUrl() + '/blog',
    blogPost: posts.slice(0, 20).map(p => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${siteUrl()}/blog/${p.slug}`,
      datePublished: p.published_at,
      author: { '@type': 'Organization', name: p.author },
    })),
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

      <header className="blog-inner blog-hero">
        <div className="blog-kicker"><i />Insights</div>
        <h1>
          The Revenue Express <em>blog.</em>
        </h1>
        <p>Strategy, trends, and insights from the frontlines of creator-led commerce.</p>
      </header>

      <main className="blog-inner">
        {posts.length === 0 ? (
          <p className="blog-empty">
            No posts published yet. Write the first one in the Command Center.
          </p>
        ) : (
          <div className="blog-grid">
            {posts.map(post => (
              <article className="blog-card" key={post.id}>
                <Link href={`/blog/${post.slug}`}>
                  {post.cover_image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="blog-card-cover"
                      src={post.cover_image}
                      alt={post.cover_alt || post.title}
                      loading="lazy"
                    />
                  )}
                  <div className="blog-card-body">
                    {post.tags.length > 0 && (
                      <div className="blog-tags">
                        {post.tags.map(tag => (
                          <span className="blog-tag" key={tag}>{tag}</span>
                        ))}
                      </div>
                    )}
                    <h2>{post.title}</h2>
                    {post.excerpt && <p>{post.excerpt}</p>}
                    <div className="blog-meta">
                      <span>{post.author}</span>
                      <span>|</span>
                      <span>{fmt(post.published_at)}</span>
                    </div>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        )}
      </main>

      <footer className="blog-foot">
        <span>© {new Date().getFullYear()} Revenue Express</span>
        <Link href="/">revenueexpress.com</Link>
      </footer>
    </div>
  );
}
