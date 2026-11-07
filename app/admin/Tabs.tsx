'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/traffic', label: 'Traffic' },
  { href: '/admin/audience', label: 'Audience' },
  { href: '/admin/leads', label: 'Leads', showCount: true },
  { href: '/admin/blog', label: 'Blog' },
];

const RANGES = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
];

export default function Tabs({ newLeads }: { newLeads: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const range = params.get('range') ?? '90d';

  // The range selector is meaningless on the CRM and the CMS, so it hides there.
  const showRanges = !pathname.startsWith('/admin/leads') && !pathname.startsWith('/admin/blog')
    && !pathname.startsWith('/admin/team');

  return (
    <nav className="p-tabsrow">
      {TABS.map(tab => {
        const active = tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            className="p-tab"
            data-active={active}
            href={`${tab.href}?range=${range}`}
          >
            {tab.label}
            {tab.showCount && newLeads > 0 && <span className="p-tab-count">{newLeads}</span>}
          </Link>
        );
      })}
      {showRanges && (
        <div className="p-ranges">
          {RANGES.map(r => (
            <Link
              key={r.key}
              className="p-range"
              data-active={r.key === range}
              href={`${pathname}?range=${r.key}`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
