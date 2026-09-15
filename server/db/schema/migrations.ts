import type { Migration } from './types';
import { migrations_001_010 } from './migrations/001-010';
import { migrations_011_020 } from './migrations/011-020';
import { migrations_021_030 } from './migrations/021-030';
import { migrations_031_040 } from './migrations/031-040';
import { migrations_041_050 } from './migrations/041-050';
import { migrations_061_070 } from './migrations/061-070';
import { migrations_051_060 } from './migrations/051-060';
import { migrations_071_080 } from './migrations/071-080';
import { migrations_081_090 } from './migrations/081-090';
import { migrations_091_100 } from './migrations/091-100';

export const migrations: Migration[] = [
	...migrations_001_010,
	...migrations_011_020,
	...migrations_021_030,
	...migrations_031_040,
	...migrations_041_050,
	...migrations_051_060,
	...migrations_061_070,
	...migrations_071_080,
	...migrations_081_090,
	...migrations_091_100,
];
