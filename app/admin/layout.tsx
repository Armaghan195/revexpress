import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { getNewLeadCount } from '@/lib/analytics';
import Tabs from './Tabs';
import SignOut from './SignOut';
import '../portal.css';

export const metadata = { title: 'Command Center — Revenue Express', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Enforced here, not just in the login response: a teammate cannot skip
  // replacing their one-time password by navigating straight to /admin.
  if (user.must_change_password) redirect('/set-password');

  const newLeads = await getNewLeadCount();

  return (
    <>
      <div className="brand-bg" aria-hidden="true" />
      <div className="portal">
      <header className="p-topbar">
        <Link href="/admin" className="p-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="p-brandmark" src="/assets/logo-mark.png" alt="" width={1106} height={754} />
          <span>Revenue<em>Express</em></span>
        </Link>
        <span className="p-divider">|</span>
        <span className="p-brand-sub">Command Center</span>
        <div className="p-topbar-right">
          <Link className="p-topbar-link" href="/blog">Blog</Link>
          {user.role === 'admin' && <Link className="p-topbar-link" href="/admin/team">Team</Link>}
          <span className="p-usermail">{user.email}</span>
          <SignOut />
        </div>
      </header>
      <Tabs newLeads={newLeads} />
      <main className="p-main">{children}</main>
      </div>
    </>
  );
}
