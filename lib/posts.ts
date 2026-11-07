/** Blog storage, markdown rendering and slugs. */
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { query, queryOne } from './db';
import { newId } from './auth';

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  cover_image: string | null;
  cover_alt: string | null;
  tags: string[];
  author: string;
  status: 'draft' | 'published';
  seo_title: string | null;
  seo_description: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export const PostInput = z.object({
  title: z.string().trim().min(1).max(220),
  slug: z.string().trim().max(200).optional(),
  excerpt: z.string().trim().max(600).optional().nullable(),
  body_md: z.string().max(200_000).default(''),
  cover_image: z.string().trim().max(1000).optional().nullable(),
  cover_alt: z.string().trim().max(300).optional().nullable(),
  tags: z.array(z.string().trim().max(40)).max(8).default([]),
  author: z.string().trim().max(120).optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  seo_title: z.string().trim().max(200).optional().nullable(),
  seo_description: z.string().trim().max(400).optional().nullable(),
});
export type PostInputType = z.infer<typeof PostInput>;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';
}

/** Appends -2, -3 … until the slug is free. */
async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  let slug = base;
  for (let n = 2; n < 200; n++) {
    const clash = await queryOne<{ id: string }>('SELECT id FROM posts WHERE slug = $1', [slug]);
    if (!clash || clash.id === exceptId) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Markdown to HTML. Even though only signed-in staff can author posts, the
 * output is sanitised: an editor account is not a reason to allow script tags
 * onto a public page.
 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md ?? '', { async: false }) as string;
  return sanitizeHtml(raw, {
    allowedTags: [
      'h1','h2','h3','h4','h5','h6','p','a','ul','ol','li','blockquote','code','pre',
      'strong','em','del','hr','br','img','figure','figcaption','table','thead','tbody',
      'tr','th','td','span',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'loading', 'width', 'height'],
      '*': ['id'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      // Outbound links open safely without the author having to remember.
      a: (tagName, attribs) => {
        const href = attribs.href ?? '';
        const external = /^https?:\/\//i.test(href);
        return {
          tagName,
          attribs: external
            ? { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
            : attribs,
        };
      },
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: 'lazy' } }),
    },
  });
}

/** Rough reading time, at 200 words per minute. */
export function readingMinutes(md: string): number {
  const words = (md || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function normalise(row: any): Post {
  return {
    ...row,
    // jsonb comes back parsed on pg and as a string on some drivers.
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags ?? []),
  };
}

export async function listPosts(opts: { status?: 'draft' | 'published' | 'all'; limit?: number } = {}) {
  const status = opts.status ?? 'published';
  const params: unknown[] = [];
  let where = '';
  if (status !== 'all') {
    params.push(status);
    where = 'WHERE status = $1';
  }
  const { rows } = await query(
    `SELECT * FROM posts ${where}
      ORDER BY COALESCE(published_at, created_at) DESC
      LIMIT ${Math.min(opts.limit ?? 100, 200)}`,
    params,
  );
  return rows.map(normalise);
}

export async function getPostBySlug(slug: string, includeDrafts = false): Promise<Post | null> {
  const row = await queryOne(
    `SELECT * FROM posts WHERE slug = $1 ${includeDrafts ? '' : "AND status = 'published'"}`,
    [slug],
  );
  return row ? normalise(row) : null;
}

export async function getPost(id: string): Promise<Post | null> {
  const row = await queryOne('SELECT * FROM posts WHERE id = $1', [id]);
  return row ? normalise(row) : null;
}

export async function createPost(input: PostInputType, userId: string): Promise<Post> {
  const id = newId('post_');
  const slug = await uniqueSlug(input.slug ? slugify(input.slug) : slugify(input.title));
  await query(
    `INSERT INTO posts (id, slug, title, excerpt, body_md, cover_image, cover_alt, tags,
                        author, status, seo_title, seo_description, published_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id, slug, input.title, input.excerpt ?? null, input.body_md ?? '',
      input.cover_image ?? null, input.cover_alt ?? null, JSON.stringify(input.tags ?? []),
      input.author || 'Revenue Express', input.status, input.seo_title ?? null,
      input.seo_description ?? null,
      input.status === 'published' ? new Date().toISOString() : null,
      userId,
    ],
  );
  return (await getPost(id))!;
}

export async function updatePost(id: string, input: PostInputType): Promise<Post | null> {
  const existing = await getPost(id);
  if (!existing) return null;
  const slug = await uniqueSlug(input.slug ? slugify(input.slug) : existing.slug, id);

  // published_at is stamped the first time a post goes live and kept thereafter,
  // so re-editing a published post does not reorder the blog.
  const publishedAt =
    input.status === 'published' ? existing.published_at ?? new Date().toISOString() : null;

  await query(
    `UPDATE posts SET slug=$2, title=$3, excerpt=$4, body_md=$5, cover_image=$6, cover_alt=$7,
            tags=$8, author=$9, status=$10, seo_title=$11, seo_description=$12,
            published_at=$13, updated_at=NOW()
      WHERE id=$1`,
    [
      id, slug, input.title, input.excerpt ?? null, input.body_md ?? '',
      input.cover_image ?? null, input.cover_alt ?? null, JSON.stringify(input.tags ?? []),
      input.author || existing.author, input.status, input.seo_title ?? null,
      input.seo_description ?? null, publishedAt,
    ],
  );
  return getPost(id);
}

export async function deletePost(id: string) {
  await query('DELETE FROM posts WHERE id = $1', [id]);
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}
