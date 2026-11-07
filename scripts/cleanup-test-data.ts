/** Removes rows created by the automated test suites. */
import { query, closeDb } from '../lib/db';

async function main() {
  const r1 = await query(
    `DELETE FROM users WHERE email LIKE 'member.%@revenueexpress.com'
                          OR email LIKE 'sec.%@revenueexpress.com'`,
  );
  // Every suite addresses its fixtures to a .test domain, which RFC 2606
  // reserves and no real enquiry can use.
  const r2 = await query(`DELETE FROM leads WHERE email LIKE '%.test'`);
  const r3 = await query(`DELETE FROM posts WHERE slug LIKE 'deep-test-post-%'`);
  const r4 = await query(`DELETE FROM login_attempts`);
  console.log(`Removed ${r1.rowCount} test users, ${r2.rowCount} test leads, ${r3.rowCount} test posts.`);
  console.log(`Cleared ${r4.rowCount} login attempt records.`);
  await closeDb();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
