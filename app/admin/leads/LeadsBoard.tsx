'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Lead, LeadContext, LeadNote, LeadStatus } from '@/lib/leads';

// Blue through orange, so the stage order reads as a progression rather than
// five unrelated colours.
const STAGES: { key: LeadStatus; label: string; tone: string }[] = [
  { key: 'new', label: 'New', tone: '#5b9dff' },
  { key: 'contacted', label: 'Contacted', tone: '#8fbaff' },
  { key: 'qualified', label: 'Qualified', tone: '#ffc27a' },
  { key: 'won', label: 'Won', tone: '#ff9d4d' },
  { key: 'lost', label: 'Lost', tone: '#6b7595' },
];

const digits = (p: string | null) => (p ? p.replace(/\D/g, '') : '');

const SECTION_LABELS: Record<string, string> = {
  hero: 'Hero', stats: 'Proof stats', problem: 'The problem', engine: 'The engine',
  framework: 'Framework', avatars: 'Avatar discovery', distribution: 'Distribution',
  results: 'Results', pricing: 'Pricing', timeline: 'Timeline', contact: 'Contact form',
};
const sectionLabel = (id: string | null) => (id ? SECTION_LABELS[id] ?? id : '—');

function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LeadsBoard({
  initialLeads,
  counts,
}: {
  initialLeads: Lead[];
  counts: Record<string, number>;
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [tally, setTally] = useState(counts);
  const [status, setStatus] = useState<LeadStatus | 'all'>('all');
  const [type, setType] = useState<'all' | 'brand' | 'creator'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialLeads[0]?.id ?? null);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [context, setContext] = useState<LeadContext | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => leads.find(l => l.id === selectedId) ?? null, [leads, selectedId]);

  // Refetch whenever a filter changes; debounced so typing does not spam the API.
  useEffect(() => {
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ status, type });
      if (search.trim()) params.set('q', search.trim());
      const res = await fetch('/api/leads?' + params);
      if (!res.ok) return;
      const data = await res.json();
      setLeads(data.leads);
      setSelectedId(prev => (data.leads.some((l: Lead) => l.id === prev) ? prev : data.leads[0]?.id ?? null));
    }, 220);
    return () => clearTimeout(timer);
  }, [status, type, search]);

  useEffect(() => {
    if (!selectedId) { setNotes([]); setContext(null); return; }
    fetch('/api/leads/' + selectedId)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!d) return; setNotes(d.notes); setContext(d.context ?? null); })
      .catch(() => {});
  }, [selectedId]);

  async function move(next: LeadStatus) {
    if (!selected || busy) return;
    setBusy(true);
    const res = await fetch('/api/leads/' + selected.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (!res.ok) return;
    const data = await res.json();
    setLeads(prev => prev.map(l => (l.id === data.lead.id ? data.lead : l)));
    setNotes(data.notes);
    setTally(prev => ({
      ...prev,
      [selected.status]: Math.max(0, (prev[selected.status] ?? 1) - 1),
      [next]: (prev[next] ?? 0) + 1,
    }));
  }

  async function saveNote() {
    if (!selected || !noteDraft.trim()) return;
    setBusy(true);
    const res = await fetch('/api/leads/' + selected.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: noteDraft }),
    });
    setBusy(false);
    if (!res.ok) return;
    const data = await res.json();
    setNotes(data.notes);
    setNoteDraft('');
  }

  const wa = selected ? digits(selected.phone) : '';

  return (
    <>
      <div className="p-statgrid p-leadstats">
        <button className="p-stat p-statbtn" data-active={status === 'all'} onClick={() => setStatus('all')}>
          <span className="p-stat-label">All</span>
          <div className="p-stat-value">{tally.all ?? 0}</div>
        </button>
        {STAGES.map(stage => (
          <button
            key={stage.key}
            className="p-stat p-statbtn"
            data-active={status === stage.key}
            onClick={() => setStatus(stage.key)}
          >
            <span className="p-stat-label">
              <i className="p-dot" style={{ background: stage.tone }} /> {stage.label}
            </span>
            <div className="p-stat-value">{tally[stage.key] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="p-leadbar">
        <input
          className="p-search"
          placeholder="Search name, email, brand…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="p-leadlayout">
        <section className="p-panel p-leadtable-wrap">
          {leads.length === 0 ? (
            <p className="p-empty">No leads match these filters</p>
          ) : (
            <table className="p-leadtable">
              <thead>
                <tr><th>Lead</th><th>Type</th><th>Status</th><th>Date</th></tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr
                    key={lead.id}
                    data-selected={lead.id === selectedId}
                    onClick={() => setSelectedId(lead.id)}
                  >
                    <td>
                      <div className="p-leadname">{lead.name}</div>
                      <div className="p-leadbrand">{lead.brand || lead.email}</div>
                    </td>
                    <td><span className="p-chip" data-kind={lead.type}>{lead.type}</span></td>
                    <td><span className="p-chip" data-status={lead.status}>{lead.status}</span></td>
                    <td className="p-leaddate">{fmtDate(lead.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="p-panel p-leaddetail">
          {!selected ? (
            <p className="p-empty">Select a lead to see the detail</p>
          ) : (
            <>
              <header className="p-leadhead">
                <h2>{selected.name}</h2>
                <span className="p-chip" data-kind={selected.type}>{selected.type}</span>
              </header>
              {(selected.role_title || selected.brand) && (
                <p className="p-leadrole">
                  {[selected.role_title, selected.brand].filter(Boolean).join(' at ')}
                </p>
              )}

              <div className="p-stat-label" style={{ marginTop: 20 }}>Pipeline stage</div>
              <div className="p-stages">
                {STAGES.map(stage => (
                  <button
                    key={stage.key}
                    className="p-stagebtn"
                    data-active={selected.status === stage.key}
                    style={selected.status === stage.key ? { background: stage.tone, color: '#08080a' } : undefined}
                    disabled={busy}
                    onClick={() => move(stage.key)}
                  >
                    {stage.label}
                  </button>
                ))}
              </div>

              <div className="p-leadactions">
                <a
                  className="p-btn p-btn-sm p-btn-accent"
                  href={`mailto:${selected.email}?subject=${encodeURIComponent('Revenue Express — ' + (selected.brand || selected.name))}`}
                >
                  Email
                </a>
                <a
                  className={`p-btn p-btn-sm p-btn-ghost${wa ? '' : ' p-disabled'}`}
                  href={wa ? `https://wa.me/${wa}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={wa ? 'Open WhatsApp' : 'No phone number on this lead'}
                >
                  WhatsApp
                </a>
              </div>

              <a className="p-leadmail" href={`mailto:${selected.email}`}>{selected.email}</a>

              {/* Only what the contact form actually asks for. Fields the form
                  does not collect are not shown as empty dashes. */}
              <dl className="p-leadgrid">
                <div><dt>Monthly ad spend</dt><dd data-tone="orange">{selected.ad_spend || '—'}</dd></div>
                <div><dt>Phone</dt><dd>{selected.phone || 'Not given'}</dd></div>
                <div><dt>Submitted</dt><dd>{fmtDate(selected.created_at)}</dd></div>
                <div><dt>Came from</dt><dd>{selected.source_path || '/'}</dd></div>
              </dl>

              {selected.message && (
                <><div className="p-stat-label" style={{ marginTop: 18 }}>What they want to scale</div>
                  <p className="p-leadtext">{selected.message}</p></>
              )}

              {/* The visit behind the enquiry, joined from analytics via the
                  session id stored on the lead. */}
              {context && (
                <>
                  <div className="p-stat-label" style={{ marginTop: 20 }}>Their visit</div>
                  <dl className="p-leadgrid">
                    <div><dt>Arrived from</dt><dd>{context.referrer || 'Direct'}</dd></div>
                    <div><dt>Time on site</dt><dd>{fmtDuration(context.durationMs)}</dd></div>
                    <div><dt>Got as far as</dt>
                      <dd data-tone="blue">{sectionLabel(context.deepestSection)}</dd></div>
                    <div><dt>Scrolled</dt><dd>{context.maxScroll}%</dd></div>
                    <div><dt>Device</dt><dd>{context.device || '—'}</dd></div>
                    <div><dt>CTA clicks</dt><dd data-tone="orange">{context.ctaClicks}</dd></div>
                  </dl>
                </>
              )}

              <div className="p-stat-label" style={{ marginTop: 22 }}>Activity</div>
              <div className="p-noteadd">
                <input
                  placeholder="Add a note…"
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveNote(); }}
                />
                <button className="p-btn p-btn-sm" disabled={busy || !noteDraft.trim()} onClick={saveNote}>
                  Add
                </button>
              </div>
              <ul className="p-notes">
                {notes.length === 0 && <li className="p-empty" style={{ padding: '14px 0' }}>No activity yet</li>}
                {notes.map(note => (
                  <li key={note.id} data-kind={note.kind}>
                    <span>{note.body}</span>
                    <time>{fmtDate(note.created_at)}{note.author ? ` · ${note.author}` : ''}</time>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
