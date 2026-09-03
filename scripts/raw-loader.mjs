// Node module-customization hook that mimics Vite's `?raw` imports for node:test.
// Registered by scripts/test.mjs alongside tsx so server/migrations.ts loads unchanged.
import { register } from 'node:module';

register(new URL('./raw-loader-hooks.mjs', import.meta.url));
