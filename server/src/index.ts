import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = createApp(config);
const port = await app.listen();

console.log(`WiiUp server on http://localhost:${port}`);
console.log(`  simulation ${config.sim ? 'on' : 'off'} · database ${config.dbPath} · admin API ${config.adminToken ? 'on' : 'off'}`);
if (config.demoCode) console.log(`  demo sign-in code: ${config.demoCode}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
