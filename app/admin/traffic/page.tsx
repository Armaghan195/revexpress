import {
  resolveRange, getTraffic, getTrend, getTopPages, getReferrers, getCtaBreakdown, getSectionReach,
} from '@/lib/analytics';
import { BarList, ChartLegend, Panel, StatCard, TrendChart, compact } from '../ui';

export const dynamic = 'force-dynamic';

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const r = resolveRange(range);
  const [traffic, trend, pages, referrers, ctas, sections] = await Promise.all([
    getTraffic(r), getTrend(r), getTopPages(r), getReferrers(r),
    getCtaBreakdown(r), getSectionReach(r),
  ]);

  return (
    <>
      <div className="p-statgrid">
        <StatCard label="Sessions" value={compact(traffic.sessions.value)} stat={traffic.sessions} />
        <StatCard
          label="Bounce Rate"
          value={`${Math.round(traffic.bounceRate.value)}%`}
          stat={traffic.bounceRate}
        />
        <StatCard
          label="Engaged Sessions"
          value={`${Math.round(traffic.engagedRate.value)}%`}
          stat={traffic.engagedRate}
          tone="orange"
          note="15s+ or 50%+ scroll"
        />
        <StatCard label="CTA Clicks" value={compact(traffic.ctaClicks.value)} stat={traffic.ctaClicks} tone="orange" />
      </div>

      <Panel title="Traffic Trend" right={<ChartLegend />}>
        <TrendChart points={trend} hourly={r.key === '24h'} />
      </Panel>

      <div className="p-cols-2">
        <Panel title="Referrers"><BarList items={referrers} tone="orange" empty="No referrers yet" /></Panel>
        {/* Which call to action is actually earning the click. */}
        <Panel title="Which CTA Gets Clicked">
          <BarList items={ctas} tone="gradient" empty="No CTA clicks yet" />
        </Panel>
      </div>

      <div className="p-cols-2">
        <Panel title="How Far They Get">
          <BarList items={sections} empty="No sections reached yet" />
        </Panel>
        <Panel title="Pages"><BarList items={pages} empty="No page views yet" /></Panel>
      </div>
    </>
  );
}
