'use client';

import { useState } from 'react';
import type { Post } from '@/lib/posts';

const BLANK = {
  id: '',
  title: '',
  slug: '',
  excerpt: '',
  body_md: '',
  cover_image: '',
  cover_alt: '',
  tags: '',
  author: 'Revenue Express',
  status: 'draft' as 'draft' | 'published',
  seo_title: '',
  seo_description: '',
};

type Draft = typeof BLANK;

function toDraft(post: Post): Draft {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? '',
    body_md: post.body_md ?? '',
    cover_image: post.cover_image ?? '',
    cover_alt: post.cover_alt ?? '',
    tags: post.tags.join(', '),
    author: post.author,
    status: post.status,
    seo_title: post.seo_title ?? '',
    seo_description: post.seo_description ?? '',
  };
}

export default function BlogManager({ initialPosts }: { initialPosts: Post[] }) {
  const [posts, setPosts] = useState(initialPosts);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const set = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));

  async function refresh() {
    const res = await fetch('/api/posts');
    if (res.ok) setPosts((await res.json()).posts);
  }

  async function save(status?: 'draft' | 'published') {
    if (!draft) return;
    if (!draft.title.trim()) {
      return setMessage({ kind: 'error', text: 'Give the post a title first' });
    }
    setBusy(true);
    setMessage(null);

    const payload = {
      title: draft.title,
      slug: draft.slug || undefined,
      excerpt: draft.excerpt || null,
      body_md: draft.body_md,
      cover_image: draft.cover_image || null,
      cover_alt: draft.cover_alt || null,
      tags: draft.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 8),
      author: draft.author,
      status: status ?? draft.status,
      seo_title: draft.seo_title || null,
      seo_description: draft.seo_description || null,
    };

    const res = await fetch(draft.id ? `/api/posts/${draft.id}` : '/api/posts', {
      method: draft.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return setMessage({ kind: 'error', text: err.error || 'Could not save' });
    }
    const { post } = await res.json();
    setDraft(toDraft(post));
    await refresh();
    setMessage({
      kind: 'ok',
      text: post.status === 'published' ? 'Published — live on /blog' : 'Draft saved',
    });
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (draft?.id === id) setDraft(null);
    await refresh();
  }

  if (draft) {
    return (
      <section className="p-panel p-editor">
        <header className="p-panel-head">
          <h2 className="p-panel-title">{draft.id ? 'Edit post' : 'New post'}</h2>
          <div className="p-editor-actions">
            <button className="p-btn p-btn-sm p-btn-ghost" onClick={() => { setDraft(null); setMessage(null); }}>
              Close
            </button>
            <button className="p-btn p-btn-sm p-btn-ghost" disabled={busy} onClick={() => save('draft')}>
              Save draft
            </button>
            <button className="p-btn p-btn-sm" disabled={busy} onClick={() => save('published')}>
              {busy ? 'Saving…' : 'Publish'}
            </button>
          </div>
        </header>

        {message && <div className={message.kind === 'ok' ? 'p-ok' : 'p-error'}>{message.text}</div>}

        <div className="p-editor-grid">
          <div>
            <label className="p-field">
              <span>Title</span>
              <input value={draft.title} onChange={e => set({ title: e.target.value })}
                     placeholder="Best TikTok Shop Agencies in 2026" />
            </label>
            <label className="p-field">
              <span>Excerpt — shown on the blog index and in search results</span>
              <textarea rows={3} value={draft.excerpt} onChange={e => set({ excerpt: e.target.value })} />
            </label>
            <label className="p-field">
              <span>Body (Markdown)</span>
              <textarea rows={20} className="p-mono" value={draft.body_md}
                        onChange={e => set({ body_md: e.target.value })}
                        placeholder={'## A heading\n\nYour copy here. **Bold**, _italic_, [links](https://example.com), lists and quotes all work.'} />
            </label>
          </div>

          <aside>
            <label className="p-field">
              <span>Status</span>
              <select value={draft.status} onChange={e => set({ status: e.target.value as any })}>
                <option value="draft">Draft — not visible publicly</option>
                <option value="published">Published — live on /blog</option>
              </select>
            </label>
            <label className="p-field">
              <span>URL slug</span>
              <input value={draft.slug} onChange={e => set({ slug: e.target.value })}
                     placeholder="auto-generated from the title" />
            </label>
            <label className="p-field">
              <span>Tags — comma separated</span>
              <input value={draft.tags} onChange={e => set({ tags: e.target.value })}
                     placeholder="TikTok Shop, Agencies" />
            </label>
            <label className="p-field">
              <span>Cover image URL</span>
              <input value={draft.cover_image} onChange={e => set({ cover_image: e.target.value })}
                     placeholder="/assets/ad1.png or https://…" />
            </label>
            <label className="p-field">
              <span>Cover alt text</span>
              <input value={draft.cover_alt} onChange={e => set({ cover_alt: e.target.value })} />
            </label>
            <label className="p-field">
              <span>Author</span>
              <input value={draft.author} onChange={e => set({ author: e.target.value })} />
            </label>

            <div className="p-seo">
              <div className="p-stat-label">Search appearance</div>
              <label className="p-field">
                <span>SEO title — defaults to the post title</span>
                <input value={draft.seo_title} onChange={e => set({ seo_title: e.target.value })} />
              </label>
              <label className="p-field">
                <span>Meta description — defaults to the excerpt</span>
                <textarea rows={3} value={draft.seo_description}
                          onChange={e => set({ seo_description: e.target.value })} />
              </label>
              <div className="p-serp">
                <div className="p-serp-url">
                  revenueexpress.com › blog › {draft.slug || 'your-post'}
                </div>
                <div className="p-serp-title">{draft.seo_title || draft.title || 'Post title'}</div>
                <div className="p-serp-desc">
                  {draft.seo_description || draft.excerpt || 'Add an excerpt so search results read well.'}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="p-leadbar">
        <button className="p-btn p-btn-sm" onClick={() => { setDraft({ ...BLANK }); setMessage(null); }}>
          + New post
        </button>
        <a className="p-btn p-btn-sm p-btn-ghost" href="/blog" target="_blank" rel="noopener noreferrer">
          View public blog
        </a>
      </div>

      <section className="p-panel p-leadtable-wrap">
        {posts.length === 0 ? (
          <p className="p-empty">No posts yet — write the first one.</p>
        ) : (
          <table className="p-leadtable">
            <thead>
              <tr><th>Post</th><th>Status</th><th>Published</th><th /></tr>
            </thead>
            <tbody>
              {posts.map(post => (
                <tr key={post.id}>
                  <td onClick={() => setDraft(toDraft(post))} style={{ cursor: 'pointer' }}>
                    <div className="p-leadname">{post.title}</div>
                    <div className="p-leadbrand">/blog/{post.slug}</div>
                  </td>
                  <td><span className="p-chip" data-status={post.status === 'published' ? 'won' : 'new'}>
                    {post.status}
                  </span></td>
                  <td className="p-leaddate">
                    {post.published_at
                      ? new Date(post.published_at).toLocaleDateString('en-US',
                          { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="p-linkbtn" onClick={() => setDraft(toDraft(post))}>Edit</button>
                    {post.status === 'published' && (
                      <a className="p-linkbtn" href={`/blog/${post.slug}`} target="_blank" rel="noopener noreferrer">
                        View
                      </a>
                    )}
                    <button className="p-linkbtn p-linkbtn-danger" disabled={busy}
                            onClick={() => remove(post.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
