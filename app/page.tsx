/**
 * The marketing site.
 *
 * The original hand-built page is kept verbatim in content/marketing.html and
 * injected here, rather than rewritten as JSX. That keeps the markup — and the
 * five test suites that check it — byte-identical, while Next serves it
 * server-rendered, so search engines still get the full HTML. Its CSS and JS
 * load from /public exactly as before.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import Script from 'next/script';
import { siteUrl } from '@/lib/posts';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Revenue Express — The Brand That Has A Creator Army',
  description:
    'Revenue Express scales high-growth DTC brands through AI creator content, Meta advertising, and cross-platform distribution.',
  alternates: { canonical: siteUrl() },
  manifest: '/site.webmanifest',
  themeColor: '#05070f',
  icons: {
    icon: [
      { url: '/assets/favicon.ico', sizes: 'any' },
      { url: '/assets/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/assets/favicon-16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: [{ url: '/assets/favicon-180.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    url: siteUrl(),
    title: 'Revenue Express — The Brand That Has A Creator Army',
    description:
      'Revenue Express scales high-growth DTC brands through AI creator content, Meta advertising, and cross-platform distribution.',
    images: ['/assets/logo-lockup.png'],
  },
  twitter: { card: 'summary_large_image' },
};

/** Pull the <body> contents out of the source page; <head> is Next's job now. */
function marketingBody(): string {
  const file = path.join(process.cwd(), 'content', 'marketing.html');
  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (match ? match[1] : html)
    // main.js is loaded through next/script instead, so it is not duplicated.
    .replace(/<script[^>]*src=["'][^"']*main\.js["'][^>]*>\s*<\/script>/gi, '');
}

export default function HomePage() {
  return (
    <>
      <link rel="stylesheet" href="/css/style.css" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <div dangerouslySetInnerHTML={{ __html: marketingBody() }} />
      <Script src="/js/track.js" strategy="afterInteractive" />
      <Script src="/js/main.js" strategy="afterInteractive" />
    </>
  );
}
