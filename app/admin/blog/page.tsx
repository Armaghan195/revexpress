import { listPosts } from '@/lib/posts';
import BlogManager from './BlogManager';

export const dynamic = 'force-dynamic';

export default async function AdminBlogPage() {
  const posts = await listPosts({ status: 'all', limit: 200 });
  return <BlogManager initialPosts={posts} />;
}
