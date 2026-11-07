import type { MetadataRoute } from 'next';
import { listPosts, siteUrl } from '@/lib/posts';

export const dynamic = 'force-dynamic';

/** Published posts appear here automatically the moment they go live. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const posts = await listPosts({ status: 'published', limit: 200 });

  return [
    { url: base, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/blog`, changeFrequency: 'daily', priority: 0.8 },
    ...posts.map(post => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.updated_at),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
