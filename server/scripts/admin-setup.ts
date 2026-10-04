// One-time setup for the Watcher app's admin login. Run ON THE DROPLET:
//
//   cd /opt/daftar-albaqala/server && npx tsx scripts/admin-setup.ts
//
// It asks for your phone and a NEW admin password (typed, not passed as an
// argument, so it never lands in shell history), then prints four lines to
// append to server/.env and the key to type into your authenticator app.
// Nothing is written anywhere by this script — you copy what it prints.
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { newTotpSecret } from '../src/admin/totp';

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Echo nothing while the password is typed.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    })
  );
}

async function main() {
  const phone = (await ask('Your phone (digits): ')).replace(/[\s-]/g, '').replace(/^\+/, '');
  if (!/^\d{6,20}$/.test(phone)) throw new Error('phone must be 6–20 digits');

  const pw = await ask('New admin password (min 12 chars): ', true);
  if (pw.length < 12) throw new Error('password must be at least 12 characters');
  const again = await ask('Repeat password: ', true);
  if (pw !== again) throw new Error('passwords do not match');

  const hash = await bcrypt.hash(pw, 12);
  const totp = newTotpSecret();
  const jwtSecret = randomBytes(32).toString('hex');

  console.log('\n=== 1) Append these 4 lines to server/.env ===\n');
  console.log(`ADMIN_PHONE=${phone}`);
  console.log(`ADMIN_PASSWORD_HASH='${hash}'`);
  console.log(`ADMIN_TOTP_SECRET=${totp}`);
  console.log(`ADMIN_JWT_SECRET=${jwtSecret}`);
  console.log('\n=== 2) In your authenticator app: + → "Enter a setup key" ===\n');
  console.log('Account name: Daftar Watcher');
  console.log(`Key:          ${totp}`);
  console.log('Type:         Time based');
  console.log('\n=== 3) Restart:  pm2 restart daftar-api --update-env ===\n');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
