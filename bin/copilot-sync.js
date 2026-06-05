#!/usr/bin/env node
import { run } from '../src/cli.js';

run(process.argv).catch((err) => {
  // Top-level safety net; commands handle their own expected errors.
  console.error(err?.stack || String(err));
  process.exit(1);
});
