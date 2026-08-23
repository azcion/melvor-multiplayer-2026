import type { Migration } from './types';
import { migrations_001_010 } from './migrations/001-010';
import { migrations_011_020 } from './migrations/011-020';
import { migrations_021_030 } from './migrations/021-030';
import { migrations_031_040 } from './migrations/031-040';
import { migrations_041_050 } from './migrations/041-050';

export const migrations: Migration[] = [
	...migrations_001_010,
	...migrations_011_020,
	...migrations_021_030,
	...migrations_031_040,
	...migrations_041_050,
];
