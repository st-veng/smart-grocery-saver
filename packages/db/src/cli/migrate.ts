import { databaseUrl, loadRootEnv } from '../env.js';
import { runMigrations } from '../migrate.js';

loadRootEnv();
const url = databaseUrl();
await runMigrations(url);
console.log(`Migrated ${new URL(url).pathname.slice(1)}`);
