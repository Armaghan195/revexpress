import { getCurrentUser } from '@/lib/session';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import PasswordForm from './PasswordForm';
import '../portal.css';

export const dynamic = 'force-dynamic';

export default async function PasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <div className="portal">
      <div className="brand-bg" aria-hidden="true" />
      <div className="p-login-wrap">
        <div style={{ width: '100%', maxWidth: 430 }}>
          <PasswordForm forced={user.must_change_password} />
          {!user.must_change_password && (
            <p style={{ marginTop: 16, textAlign: 'center' }}>
              <Link className="p-topbar-link" href="/admin">Back to the dashboard</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
