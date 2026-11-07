'use client';

import { useState } from 'react';

export interface Member {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  created_by_name: string | null;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';

export default function TeamManager({
  initialMembers,
  currentUserId,
}: {
  initialMembers: Member[];
  currentUserId: string;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once, then gone — the password is never stored in a readable form.
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  async function refresh() {
    const res = await fetch('/api/team');
    if (res.ok) setMembers((await res.json()).members);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || 'Could not create the account');
    setIssued({ email: data.member.email, password: data.oneTimePassword });
    setName(''); setEmail(''); setRole('member');
    refresh();
  }

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/team/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || 'That did not work');
    if (data.oneTimePassword) {
      const member = members.find(m => m.id === id);
      setIssued({ email: member?.email ?? '', password: data.oneTimePassword });
    }
    refresh();
  }

  return (
    <>
      <div className="p-cols-2">
        <section className="p-panel">
          <h2 className="p-panel-title">Add a teammate</h2>
          <p style={{ color: 'var(--p-muted)', fontSize: 13.5, marginTop: 8, lineHeight: 1.55 }}>
            There is no public signup. Creating an account here generates a one-time password,
            shown once, which they must replace when they first sign in.
          </p>
          <form onSubmit={create}>
            <label className="p-field">
              <span>Full name</span>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="Jordan Smith" />
            </label>
            <label className="p-field">
              <span>Email</span>
              <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
                     placeholder="jordan@revenueexpress.com" />
            </label>
            <label className="p-field">
              <span>Access level</span>
              <select value={role} onChange={e => setRole(e.target.value as 'member' | 'admin')}>
                <option value="member">Member — dashboards, leads and blog</option>
                <option value="admin">Admin — everything, including team accounts</option>
              </select>
            </label>
            {error && <div className="p-error">{error}</div>}
            <button className="p-btn" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          </form>
        </section>

        <section className="p-panel">
          <h2 className="p-panel-title">Credentials</h2>
          {issued ? (
            <>
              <div className="p-ok">
                Account ready. Copy these now — the password cannot be shown again.
              </div>
              <div className="p-creds">
                <div><span>Sign-in URL</span><code>/login</code></div>
                <div><span>Email</span><code>{issued.email}</code></div>
                <div><span>One-time password</span><code className="p-cred-strong">{issued.password}</code></div>
              </div>
              <button className="p-btn p-btn-sm p-btn-ghost" style={{ marginTop: 16 }}
                      onClick={() => navigator.clipboard?.writeText(
                        `Sign in at /login\nEmail: ${issued.email}\nPassword: ${issued.password}`)}>
                Copy all
              </button>
              <button className="p-btn p-btn-sm p-btn-ghost" style={{ marginTop: 16, marginLeft: 8 }}
                      onClick={() => setIssued(null)}>
                Done
              </button>
            </>
          ) : (
            <p className="p-empty">
              Create an account or reset a password, and the credentials appear here.
            </p>
          )}
        </section>
      </div>

      <section className="p-panel p-leadtable-wrap">
        <table className="p-leadtable">
          <thead>
            <tr><th>Member</th><th>Access</th><th>Status</th><th>Last sign-in</th><th /></tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id}>
                <td>
                  <div className="p-leadname">
                    {m.name}{m.id === currentUserId && <span className="p-you"> you</span>}
                  </div>
                  <div className="p-leadbrand">{m.email}</div>
                </td>
                <td><span className="p-chip" data-status={m.role === 'admin' ? 'qualified' : 'new'}>{m.role}</span></td>
                <td>
                  <span className="p-chip" data-status={m.is_active ? 'won' : 'lost'}>
                    {m.is_active ? 'active' : 'disabled'}
                  </span>
                  {m.must_change_password && m.is_active && (
                    <span className="p-chip" data-status="contacted" style={{ marginLeft: 6 }}>pending setup</span>
                  )}
                </td>
                <td className="p-leaddate">{fmt(m.last_login_at)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="p-linkbtn" disabled={busy}
                          onClick={() => act(m.id, { action: 'reset_password' })}>
                    Reset password
                  </button>
                  <button className="p-linkbtn" disabled={busy}
                          onClick={() => act(m.id, { role: m.role === 'admin' ? 'member' : 'admin' })}>
                    Make {m.role === 'admin' ? 'member' : 'admin'}
                  </button>
                  <button className="p-linkbtn p-linkbtn-danger" disabled={busy}
                          onClick={() => act(m.id, { action: m.is_active ? 'deactivate' : 'activate' })}>
                    {m.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
