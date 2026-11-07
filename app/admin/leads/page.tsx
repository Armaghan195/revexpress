import { countByStatus, listLeads } from '@/lib/leads';
import LeadsBoard from './LeadsBoard';

export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const [leads, counts] = await Promise.all([listLeads(), countByStatus()]);
  return <LeadsBoard initialLeads={leads} counts={counts} />;
}
