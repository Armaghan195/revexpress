/** Apply db/schema.sql. Idempotent: run it as often as you like. */
import { migrate, usingEmbeddedDatabase, closeDb } from '../lib/db';

async function main() {
  console.log(
    'Migrating ' +
      (usingEmbeddedDatabase()
        ? 'embedded PGlite (.pgdata/) — set DATABASE_URL to use real Postgres'
        : 'DATABASE_URL'),
  );
  await migrate();
  console.log('Schema is up to date.');
  await closeDb();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
