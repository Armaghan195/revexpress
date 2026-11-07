import {
  resolveRange, getOverview, getTrend, getSectionReach, getPipelineSnapshot,
} from '@/lib/analytics';
import { BarList, ChartLegend, Panel, StatCard, TrendChart, compact, duration } from './ui';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const r = resolveRange(range);
  const [overview, trend, sections, pipeline] = await Promise.all([
    getOverview(r), getTrend(r), getSectionReach(r), getPipelineSnapshot(),
  ]);

  return (
    <>
      <div className="p-statgrid">
        <StatCard label="Unique Visitors" value={compact(overview.visitors.value)} stat={overview.visitors} />
        <StatCard label="Page Views" value={compact(overview.views.value)} stat={overview.views} tone="blue" />
        <StatCard label="Avg. Time on Page" value={duration(overview.avgTimeMs.value)} stat={overview.avgTimeMs} />
        <StatCard
          label="Lead Conversion"
          value={`${overview.conversionPct}%`}
          tone="orange"
          note={`${overview.submissions.value} submit${overview.submissions.value === 1 ? '' : 's'}`}
        />
      </div>

      <Panel title="Traffic Trend" right={<ChartLegend />}>
        <TrendChart points={trend} hourly={r.key === '24h'} />
      </Panel>

      <div className="p-cols-3">
        <Panel title="Conversion Funnel">
          <BarList
            items={overview.funnel.map((step, i) => ({
              label: step.label,
              value: step.value,
              // Each step shows its rate against the step above it.
              meta:
                i === 0 || !overview.funnel[i - 1].value
                  ? undefined
                  : `${Math.round((step.value / overview.funnel[i - 1].value) * 100)}%`,
            }))}
            empty="No visits recorded yet"
          />
        </Panel>

        {/* One page with anchor sections, so how far visitors get down it is
            the meaningful measure — not which URL they landed on. */}
        <Panel title="How Far They Get">
          <BarList items={sections} empty="No sections reached yet" />
        </Panel>

        <Panel title="Pipeline Snapshot">
          {/* Reflects what this site captures: one contact form, whose key
              qualifier is the monthly ad spend band the visitor selects. */}
          <dl className="p-kv">
            <div><dt>Total leads</dt><dd>{pipeline.total}</dd></div>
            <div><dt>Uncontacted</dt><dd data-tone="orange">{pipeline.uncontacted}</dd></div>
            <div><dt>In progress</dt><dd data-tone="blue">{pipeline.inProgress}</dd></div>
            <div><dt>Won</dt><dd data-tone="soft">{pipeline.won}</dd></div>
            <div><dt>$50K+ ad spend</dt><dd data-tone="orange">{pipeline.highSpend}</dd></div>
            <div><dt>Blog published</dt><dd>{pipeline.postsPublished}</dd></div>
          </dl>
        </Panel>
      </div>
    </>
  );
}
