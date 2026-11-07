import { PostInput, createPost, listPosts } from '@/lib/posts';
import { requireUser } from '@/lib/session';
import { fail, json, route } from '@/lib/http';

export const runtime = 'nodejs';

export const GET = route(async () => {
  await requireUser();
  return json({ posts: await listPosts({ status: 'all', limit: 200 }) });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const parsed = PostInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail('Check the fields', 400, { fields: parsed.error.flatten().fieldErrors });
  }
  return json({ post: await createPost(parsed.data, user.id) }, 201);
});
