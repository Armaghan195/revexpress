import { PostInput, deletePost, getPost, updatePost } from '@/lib/posts';
import { requireUser } from '@/lib/session';
import { fail, json, route } from '@/lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const post = await getPost(id);
  if (!post) return fail('Post not found', 404);
  return json({ post });
});

export const PUT = route(async (req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = PostInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail('Check the fields', 400, { fields: parsed.error.flatten().fieldErrors });
  }
  const post = await updatePost(id, parsed.data);
  if (!post) return fail('Post not found', 404);
  return json({ post });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  await deletePost(id);
  return json({ ok: true });
});
