// Only synthetic browser fixtures are served here; no Next server, credentials or database.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const bundle = await build({ entryPoints: ['app/tests/browser/fixture.tsx'], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = await postcss([tailwindcss()]).process(await readFile('app/src/app/globals.css', 'utf8'), { from: 'app/src/app/globals.css' });
createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="en"><head><title>Nest Ledger test fixture</title><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
}).listen(3107, '127.0.0.1');
