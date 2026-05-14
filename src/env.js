import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv() {
  const envPath = existsSync(resolve(process.cwd(), '.env'))
    ? resolve(process.cwd(), '.env')
    : resolve(process.cwd(), '.env.example');

  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.includes('put_your_key_here')) {
    throw new Error(`${name} is missing. Add it to .env first.`);
  }
  return value;
}

