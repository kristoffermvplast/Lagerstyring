import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT, config.HOST);
}

main().catch(() => {
  // Config, TLS and connection exceptions may contain secrets. Log no raw exception.
  console.error('API startup failed. Check required environment configuration and server diagnostics.');
  process.exitCode = 1;
});
