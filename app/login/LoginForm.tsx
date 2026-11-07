'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not sign in');
        setBusy(false);
        return;
      }
      // A provisioned account lands on the password screen before anything else.
      router.push(data.mustChangePassword ? '/set-password' : '/admin');
      router.refresh();
    } catch {
      setError('Network error — check your connection');
      setBusy(false);
    }
  }

  return (
    <form className="p-login" onSubmit={submit}>
      <div className="p-login-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark.png" alt="" width={1106} height={754} />
        <span>Revenue<em>Express</em></span>
      </div>
      <h1>Command Center</h1>
      <p className="sub">
        Revenue Express team access. Accounts are issued by an administrator.
      </p>

      <label className="p-field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@revenueexpress.com"
        />
      </label>

      <label className="p-field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••••"
        />
      </label>

      {error && <div className="p-error">{error}</div>}

      <button className="p-btn" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
