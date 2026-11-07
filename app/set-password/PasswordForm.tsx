'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError('The two new passwords do not match');
    setBusy(true);
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, next }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || 'Could not change password');
    setDone(true);
    setCurrent(''); setNext(''); setConfirm('');
    router.refresh();
    if (forced) router.push('/admin');
  }

  return (
    <form className="p-login" onSubmit={submit}>
      <h2 className="p-panel-title">{forced ? 'Choose your own password' : 'Change password'}</h2>
      <p style={{ color: 'var(--p-muted)', fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>
        {forced
          ? 'Your account was created with a one-time password. Pick your own to continue.'
          : 'Changing your password signs out every other device.'}
      </p>

      <label className="p-field">
        <span>Current password</span>
        <input type="password" autoComplete="current-password" required
               value={current} onChange={e => setCurrent(e.target.value)} />
      </label>
      <label className="p-field">
        <span>New password</span>
        <input type="password" autoComplete="new-password" required
               value={next} onChange={e => setNext(e.target.value)} />
      </label>
      <label className="p-field">
        <span>Confirm new password</span>
        <input type="password" autoComplete="new-password" required
               value={confirm} onChange={e => setConfirm(e.target.value)} />
      </label>

      {error && <div className="p-error">{error}</div>}
      {done && !forced && <div className="p-ok">Password updated.</div>}

      <button className="p-btn" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
    </form>
  );
}
