import { readFileSync } from 'node:fs';

export const readText = (path: string): string => readFileSync(path, 'utf8');
