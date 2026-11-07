import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { query } from '@/lib/db';
import TeamManager, { type Member } from './TeamManager';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Members can reach the URL, but only admins manage accounts.
  if (user.role !== 'admin') {
    return (
      <section className="p-panel">
        <h2 className="p-panel-title">Team</h2>
        <p className="p-empty">Only administrators can manage team accounts.</p>
      </section>
    );
  }

  const { rows } = await query<Member>(
    `SELECT u.id, u.email, u.name, u.role, u.is_active, u.must_change_password,
            u.created_at, u.last_login_at, c.name AS created_by_name
       FROM users u LEFT JOIN users c ON c.id = u.created_by
      ORDER BY u.created_at ASC`,
  );
  return <TeamManager initialMembers={rows} currentUserId={user.id} />;
}
