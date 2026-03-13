import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vitePath = resolve(__dirname, 'client/node_modules/vite/dist/node/index.js');
const { createServer } = await import('file:///' + vitePath.replace(/\\/g, '/'));

const server = await createServer({
  root: resolve(__dirname, 'client'),
  configFile: resolve(__dirname, 'client/vite.config.js'),
  server: { port: 5173 },
});
await server.listen();
server.printUrls();

// Keep the process alive
process.stdin.resume();
