import { createApiApp } from './api-app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApiApp(config);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
