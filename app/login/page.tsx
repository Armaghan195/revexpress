import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import LoginForm from './LoginForm';
import '../portal.css';

export const metadata = { title: 'Sign in — Revenue Express', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Already signed in? Skip the form.
  const user = await getCurrentUser();
  if (user) redirect('/admin');
  return (
    <div className="portal">
      <div className="brand-bg" aria-hidden="true" />
      <div className="p-login-wrap">
        <LoginForm />
      </div>
    </div>
  );
}
