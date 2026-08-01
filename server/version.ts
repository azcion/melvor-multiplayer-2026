import { readFileSync } from 'node:fs';

const version_text = readFileSync(new URL('./backend-version.txt', import.meta.url), 'utf8').trim();

if (!/^[1-9][0-9]*$/.test(version_text))
	throw new Error(`Invalid backend deployment version: ${version_text}`);

export const BACKEND_VERSION = Number(version_text);
