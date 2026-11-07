import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/posts';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The portal and its APIs have no business in a search index.
        disallow: ['/admin', '/admin/', '/login', '/api/'],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
