import { resolveRange, getAudience, getDevices, getCountries, getNewVsReturning } from '@/lib/analytics';
import { BarList, Panel, StatCard, compact } from '../ui';

export const dynamic = 'force-dynamic';

export default async function AudiencePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const r = resolveRange(range);
  const [audience, devices, countries, loyalty] = await Promise.all([
    getAudience(r), getDevices(r), getCountries(r), getNewVsReturning(r),
  ]);

  return (
    <>
      <div className="p-statgrid">
        <StatCard label="Visitors" value={compact(audience.visitors.value)} stat={audience.visitors} />
        <StatCard
          label="Avg. Scroll Depth"
          value={`${Math.round(audience.scroll.value)}%`}
          stat={audience.scroll}
          tone="blue"
        />
        <StatCard label="Sessions / Visitor" value={audience.sessionsPerVisitor.value.toFixed(1)} />
        <StatCard label="Views / Session" value={audience.viewsPerSession.value.toFixed(1)} tone="orange" />
      </div>

      <div className="p-cols-3">
        <Panel title="Devices"><BarList items={devices} empty="No sessions yet" /></Panel>
        <Panel title="Top Countries"><BarList items={countries} tone="orange" empty="No sessions yet" /></Panel>
        {/* Brand-vs-creator "intent" only means something on a site with two
            application forms. This one has a single contact form, so the useful
            split is whether the visitor has been here before. */}
        <Panel title="New vs Returning">
          <BarList items={loyalty} tone="orange" empty="No sessions yet" />
        </Panel>
      </div>
    </>
  );
}
