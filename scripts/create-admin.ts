/**
 * Create the first super admin. Every other account is created from inside the
 * portal after this.
 *
 *   npm run admin:create -- you@company.com "Your Name" [password]
 */
import { createUser, generatePassword } from '../lib/auth';
import { migrate, closeDb, queryOne } from '../lib/db';

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage: npm run admin:create -- <email> "<name>" [password]');
    process.exit(1);
  }

  await migrate();

  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    email.trim().toLowerCase(),
  ]);
  if (existing) {
    console.error('An account already exists for ' + email);
    await closeDb();
    process.exit(1);
  }

  const chosen = password || generatePassword();
  const created = await createUser({
    email,
    name,
    role: 'admin',
    password: chosen,
    // A password you chose yourself needs no forcing; a generated one does.
    mustChangePassword: !password,
  });

  console.log('\n  Super admin created');
  console.log('  ------------------------------------------');
  console.log('  Email:    ' + created.email);
  console.log('  Password: ' + chosen);
  if (!password) console.log('  (you will be asked to change this on first sign-in)');
  console.log('  ------------------------------------------\n');
  await closeDb();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
