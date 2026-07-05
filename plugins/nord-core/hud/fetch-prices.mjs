import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';

const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const dst = path.join(cfgDir, 'hud', 'prices-cache.json');

https.get('https://raw.githubusercontent.com/juliuswiener/nord-kit/main/plugins/nord-core/prices.json', (res) => {
  if (res.statusCode !== 200) return;
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      JSON.parse(data); // validate JSON
      fs.writeFileSync(dst, data, 'utf8');
    } catch {}
  });
}).on('error', () => {});
