import { databaseUrl, loadRootEnv } from '../env.js';
import { resetDatabase } from '../migrate.js';

loadRootEnv();
const url = databaseUrl();
if (process.env.NODE_ENV === 'production') {
  console.error('db:reset refuses to run with NODE_ENV=production');
  process.exit(1);
}
await resetDatabase(url);
console.log(`Reset + migrated ${new URL(url).pathname.slice(1)}`);
