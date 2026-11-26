// tests/helpers.js - Shared test utilities, Chrome MV3 API mocks, and bundle readers
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

export function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
}

export function readBundle(relPaths) {
  return relPaths.map(p => `// === ${p} ===\n${readRepoFile(p)}`).join('\n\n');
}

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

export function installChromeMock() {
  globalThis.chrome = globalThis.chrome || {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: () => {} }
    },
    debugger: { attach: () => {}, sendCommand: () => {} },
    scripting: { executeScript: () => {} },
    tabs: { sendMessage: () => {} }
  };
}
