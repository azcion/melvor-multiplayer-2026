import type { Migration } from '../types';

// Frozen reviewed catalog. Later corrections must use a new migration, never rewrite observation clocks.
export const cheat_categories_migration: Migration = {
	version: 187,
	sql: `
CREATE TABLE mod_categories (
 id TEXT PRIMARY KEY CHECK(id IN ('time','items','resources','multitasking','shops','loot_rng')),
 sort_order INTEGER NOT NULL UNIQUE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
INSERT INTO mod_categories(id,sort_order) VALUES ('time',0),('items',1),('resources',2),('multitasking',3),('shops',4),('loot_rng',5);
CREATE TABLE mod_catalog (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 9007199254740991),
 mod_io_id INTEGER UNIQUE CHECK(mod_io_id IS NULL OR mod_io_id BETWEEN 1 AND 9007199254740991),
 canonical_name TEXT NOT NULL,
 legacy_interdict_member INTEGER NOT NULL DEFAULT 0 CHECK(legacy_interdict_member IN (0,1))
);
CREATE TABLE mod_catalog_aliases (
 alias TEXT PRIMARY KEY,
 mod_catalog_id INTEGER NOT NULL REFERENCES mod_catalog(id),
 evidence_reference TEXT NOT NULL
);
CREATE TABLE mod_category_classifications (
 id INTEGER PRIMARY KEY,
 mod_catalog_id INTEGER NOT NULL REFERENCES mod_catalog(id),
 category_id TEXT NOT NULL REFERENCES mod_categories(id),
 confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low','unknown')),
 publication_state TEXT NOT NULL CHECK(publication_state IN ('approved','pending','rejected')),
 rationale TEXT NOT NULL,
 public_explanation TEXT NOT NULL DEFAULT '',
 evidence_reference TEXT NOT NULL,
 superseded_at INTEGER CHECK(superseded_at IS NULL OR (typeof(superseded_at)='integer' AND superseded_at BETWEEN 0 AND 9007199254740991))
);
CREATE UNIQUE INDEX mod_classification_current ON mod_category_classifications(mod_catalog_id,category_id) WHERE superseded_at IS NULL;
CREATE INDEX mod_classification_public ON mod_category_classifications(category_id,mod_catalog_id) WHERE superseded_at IS NULL AND publication_state='approved' AND confidence='high';
CREATE TABLE client_mod_observations (
 client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 mod_catalog_id INTEGER NOT NULL REFERENCES mod_catalog(id),
 last_observed_at INTEGER NOT NULL CHECK(typeof(last_observed_at)='integer' AND last_observed_at BETWEEN 0 AND 9007199254740991),
 reported_name TEXT NOT NULL,
 reported_mod_io_id INTEGER CHECK(reported_mod_io_id IS NULL OR (typeof(reported_mod_io_id)='integer' AND reported_mod_io_id BETWEEN 1 AND 9007199254740991)),
 match_method TEXT NOT NULL CHECK(match_method IN ('mod_io_id','curated_name','legacy_policy')),
 evidence_source TEXT NOT NULL CHECK(evidence_source IN ('runtime','legacy_detection','snapshot')),
 PRIMARY KEY(client_id,mod_catalog_id)
);
CREATE INDEX client_mod_observation_recent ON client_mod_observations(client_id,last_observed_at,mod_catalog_id);
CREATE INDEX mod_observation_recent ON client_mod_observations(mod_catalog_id,last_observed_at,client_id);

INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(3153827,3153827,'Multitasking',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Multitasking',3153827,'https://mod.io/g/melvoridle/m/multitasking');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(3153827,'multitasking','high','approved','Explicitly trains multiple active skills simultaneously.','Explicitly trains multiple active skills simultaneously.','https://mod.io/g/melvoridle/m/multitasking');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2550564,2550564,'Time Skip',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Time Skip',2550564,'https://mod.io/g/melvoridle/m/time-skip');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2550564,'time','high','approved','Simulates additional elapsed gameplay; not merely faster offline-screen processing.','Simulates additional elapsed gameplay.','https://mod.io/g/melvoridle/m/time-skip');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4327492,4327492,'[Myth] Mordecai',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('[Myth] Mordecai',4327492,'https://mod.io/g/melvoridle/m/myth-mordecai');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4327492,'resources','high','pending','Disenchanting pays essence for random vanilla items and custom legendary gear. Additional item source is explicit; treating this balanced-content economy as cheating needs a policy decision. Random output alone does not establish RNG manipulation.','','https://mod.io/g/melvoridle/m/myth-mordecai');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4925330,4925330,'Speedup++',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Speedup++',4925330,'https://mod.io/g/melvoridle/m/speedup2');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4925330,'time','high','approved','Configurable tick acceleration online and offline.','Configurable tick acceleration online and offline.','https://mod.io/g/melvoridle/m/speedup2');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(3244425,3244425,'Speedup',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Speedup',3244425,'https://mod.io/g/melvoridle/m/speedup1');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(3244425,'time','high','approved','Configurable game speed online and offline.','Configurable game speed online and offline.','https://mod.io/g/melvoridle/m/speedup1');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4857342,4857342,'MANGO - Armor Shop',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('MANGO - Armor Shop',4857342,'https://mod.io/g/melvoridle/m/mango-armor-shop');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4857342,'shops','high','approved','Adds purchasable Mithril-to-Dragon equipment.','Adds purchasable Mithril-to-Dragon equipment.','https://mod.io/g/melvoridle/m/mango-armor-shop');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4857224,4857224,'MANGO - Food Shop',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('MANGO - Food Shop',4857224,'https://mod.io/g/melvoridle/m/mango-food-shop');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4857224,'shops','high','approved','Adds purchasable foods including Whales.','Adds purchasable foods including Whales.','https://mod.io/g/melvoridle/m/mango-food-shop');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4857419,4857419,'MANGO - Weapon Shop',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('MANGO - Weapon Shop',4857419,'https://mod.io/g/melvoridle/m/mango-weapon-shop');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4857419,'shops','high','approved','Adds purchasable weapons.','Adds purchasable weapons.','https://mod.io/g/melvoridle/m/mango-weapon-shop');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4857386,4857386,'MANGO - Crystal Shop',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('MANGO - Crystal Shop',4857386,'https://mod.io/g/melvoridle/m/mango-crystal-shop');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4857386,'shops','high','approved','Adds purchasable combat amulets and gemstones.','Adds purchasable combat amulets and gemstones.','https://mod.io/g/melvoridle/m/mango-crystal-shop');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4857489,4857489,'MANGO - Herblore Shop',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('MANGO - Herblore Shop',4857489,'https://mod.io/g/melvoridle/m/mango-herblore-shop');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4857489,'shops','high','approved','Adds purchasable herbs and potion materials.','Adds purchasable herbs and potion materials.','https://mod.io/g/melvoridle/m/mango-herblore-shop');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6289236,6289236,'Super Awesome Bank Slot Tokens!',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Super Awesome Bank Slot Tokens!',6289236,'https://mod.io/g/melvoridle/m/bank-slot-tokens-everywhere');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6289236,'resources','high','approved','Adds Bank Slot Tokens and a custom five-slot token to skill drops. Extra random drops belong to Resources; random drops alone are not Loot/RNG manipulation.','Adds Bank Slot Tokens and a custom five-slot token to skill drops.','https://mod.io/g/melvoridle/m/bank-slot-tokens-everywhere');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4528592,4528592,'Speed & Auto Eat',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Speed & Auto Eat',4528592,'https://mod.io/g/melvoridle/m/speed-and-auto-eat');
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Speed &amp; Auto Eat',4528592,'https://mod.io/g/melvoridle/m/speed-and-auto-eat');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4528592,'time','high','approved','Explicit speed control plus configurable healing thresholds and at-least-100-percent food efficiency. Combat is an unpolled supplemental category.','Explicit speed control plus configurable healing thresholds and at-least-100-percent food efficiency.','https://mod.io/g/melvoridle/m/speed-and-auto-eat');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6160627,6160627,'Rune Shop for ItA',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Rune Shop for ItA',6160627,'https://mod.io/g/melvoridle/m/rune-shop-for-ita');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6160627,'shops','high','approved','Adds purchasable Into the Abyss runes.','Adds purchasable Into the Abyss runes.','https://mod.io/g/melvoridle/m/rune-shop-for-ita');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4230134,4230134,'Gashapon',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Gashapon',4230134,'https://mod.io/g/melvoridle/m/gashapon');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4230134,'shops','medium','pending','Inventory summary describes GP-for-random-reward conversion, mostly unusable items. Current description only says discontinued; inspect item pool and purchase mechanism before publication. Ordinary gambling is not automatically RNG manipulation.','','https://mod.io/g/melvoridle/m/gashapon');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4230134,'resources','low','pending','Inventory summary describes GP-for-random-reward conversion, mostly unusable items. Current description only says discontinued; inspect item pool and purchase mechanism before publication. Ordinary gambling is not automatically RNG manipulation.','','https://mod.io/g/melvoridle/m/gashapon');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6359594,6359594,'RandomBankSlots',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('RandomBankSlots',6359594,'https://mod.io/g/melvoridle/m/randombankslots');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6359594,'resources','high','approved','Adds real vanilla Bank Slot Tokens as random skill drops with adjustable frequency.','Adds real vanilla Bank Slot Tokens as random skill drops with adjustable frequency.','https://mod.io/g/melvoridle/m/randombankslots');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2429395,2429395,'Add Items',1);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Add Items',2429395,'https://mod.io/g/melvoridle/m/additem');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2429395,'items','high','approved','Historical eight-mod Interdict policy membership; loaded presence does not establish use.','Included in the historical eight-mod Item Cheats policy.','https://mod.io/g/melvoridle/m/additem');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2732321,2732321,'Mastery Token Shop',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Mastery Token Shop',2732321,'https://mod.io/g/melvoridle/m/mastery-token-shop');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2732321,'shops','high','approved','Adds all Mastery Tokens to the shop; listing explicitly retains level-99 skill requirement. Do not claim requirement removal.','Adds all Mastery Tokens to the shop.','https://mod.io/g/melvoridle/m/mastery-token-shop');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2253095,2253095,'dev.Console',1);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('dev.Console',2253095,'https://mod.io/g/melvoridle/m/devconsole');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2253095,'items','high','approved','Historical eight-mod Interdict policy membership; loaded presence does not establish use.','Included in the historical eight-mod Item Cheats policy.','https://mod.io/g/melvoridle/m/devconsole');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(5539074,5539074,'Zeltho Quality of Life Improvements',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Zeltho Quality of Life Improvements',5539074,'https://mod.io/g/melvoridle/m/zeltho-quality-of-life-improvements');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5539074,'time','high','approved','Explicit game-speed multiplier. Unlimited offline cap is a distinct feature; do not equate the cap alone with acceleration.','Explicit game-speed multiplier.','https://mod.io/g/melvoridle/m/zeltho-quality-of-life-improvements');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2478248,2478248,'A Bit Cheating',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('A Bit Cheating',2478248,'https://mod.io/g/melvoridle/m/a-bit-cheating');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2478248,'resources','high','approved','Removes Slayer-target refresh cost and permits up to 100-percent Agility cost reduction. Combat/automation axis is supplemental and review-only.','Removes Slayer-target refresh cost and permits up to 100-percent Agility cost reduction.','https://mod.io/g/melvoridle/m/a-bit-cheating');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6199976,6199976,'Workers',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Workers',6199976,'https://mod.io/g/melvoridle/m/workers');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6199976,'multitasking','high','approved','Three non-combat workers can run alongside player combat.','Three non-combat workers can run alongside player combat.','https://mod.io/g/melvoridle/m/workers');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(3416038,3416038,'Octane''s Treasure Island',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Octane''s Treasure Island',3416038,'https://mod.io/g/melvoridle/m/octanes-treasure-island');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(3416038,'resources','high','pending','Adds a combat-content route to Bank Slot Tokens; capability is clear, but marking custom-content rewards as cheating needs explicit policy approval.','','https://mod.io/g/melvoridle/m/octanes-treasure-island');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(3384052,3384052,'Runeshop Unlimited',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Runeshop Unlimited',3384052,'https://mod.io/g/melvoridle/m/runeshop-unlimited');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(3384052,'shops','high','approved','Rune-shop fork. Inventory says level requirement removed; public description alone does not substantiate that subfeature.','Adds a rune shop.','https://mod.io/g/melvoridle/m/runeshop-unlimited');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6233922,6233922,'Multipliers',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Multipliers',6233922,'https://mod.io/g/melvoridle/m/multipliers');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6233922,'resources','high','approved','Explicit gathering-reward, XP and Mastery XP multipliers. Progression is an unpolled supplemental category; Time requires actual tick/time acceleration, not XP gain.','Offers gathering-reward multipliers.','https://mod.io/g/melvoridle/m/multipliers');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2975623,2975623,'LuckyReroll',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('LuckyReroll',2975623,'https://mod.io/g/melvoridle/m/lucky-reroll');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2975623,'loot_rng','high','approved','Inventory identifies chest rerolls; publisher describes reverting time to change luck. Classify by reroll effect, not as additional elapsed-time production.','Allows chest rewards to be rerolled.','https://mod.io/g/melvoridle/m/lucky-reroll');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6209430,6209430,'Requirement Filler',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Requirement Filler',6209430,'https://mod.io/g/melvoridle/m/shop-add-items');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6209430,'resources','high','approved','Fills item/currency costs and includes a full item/currency adder. It does not add a shop merely because its buttons appear in shops. Not an existing Interdict member.','Fills item and currency costs and offers an item and currency adder.','https://mod.io/g/melvoridle/m/shop-add-items');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(5377900,5377900,'[Creative Mode] God mode w/ Loot + XP Multipliers',1);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('[Creative Mode] God mode w/ Loot + XP Multipliers',5377900,'https://mod.io/g/melvoridle/m/drop-multiplier');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5377900,'items','high','approved','Historical eight-mod Interdict policy membership; loaded presence does not establish use.','Included in the historical eight-mod Item Cheats policy.','https://mod.io/g/melvoridle/m/drop-multiplier');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5377900,'time','medium','pending','Explicit attack-speed control, but no demonstrated global time multiplier (Time is pending); free requirement-free shop purchases; resource/currency multipliers; extra rare/pet/relic rolls; HP and XP changes. Progression and Combat are supplemental axes. Existing Interdict member.','','https://mod.io/g/melvoridle/m/drop-multiplier');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5377900,'shops','high','approved','Explicit attack-speed control, but no demonstrated global time multiplier (Time is pending); free requirement-free shop purchases; resource/currency multipliers; extra rare/pet/relic rolls; HP and XP changes. Progression and Combat are supplemental axes. Existing Interdict member.','Offers shop purchases without their usual costs or requirements.','https://mod.io/g/melvoridle/m/drop-multiplier');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5377900,'resources','high','approved','Explicit attack-speed control, but no demonstrated global time multiplier (Time is pending); free requirement-free shop purchases; resource/currency multipliers; extra rare/pet/relic rolls; HP and XP changes. Progression and Combat are supplemental axes. Existing Interdict member.','Offers resource and currency multipliers.','https://mod.io/g/melvoridle/m/drop-multiplier');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5377900,'loot_rng','high','approved','Explicit attack-speed control, but no demonstrated global time multiplier (Time is pending); free requirement-free shop purchases; resource/currency multipliers; extra rare/pet/relic rolls; HP and XP changes. Progression and Combat are supplemental axes. Existing Interdict member.','Offers extra rare, pet and relic rolls.','https://mod.io/g/melvoridle/m/drop-multiplier');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(5291505,5291505,'Linear Progressive Offline Speedup',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Linear Progressive Offline Speedup',5291505,'https://mod.io/g/melvoridle/m/linear-progressive-offline-speedup');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5291505,'time','high','approved','Counts offline time with an increasing multiplier.','Counts offline time with an increasing multiplier.','https://mod.io/g/melvoridle/m/linear-progressive-offline-speedup');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2479713,2479713,'Loot Chests',1);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Loot Chests',2479713,'https://mod.io/g/melvoridle/m/shoptest');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2479713,'items','high','approved','Historical eight-mod Interdict policy membership; loaded presence does not establish use.','Included in the historical eight-mod Item Cheats policy.','https://mod.io/g/melvoridle/m/shoptest');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2479713,'shops','high','approved','Sells custom loot chests for GP. No evidence of rerolling or editing odds, so no Loot/RNG category. Existing Interdict member despite its shop-based mechanism.','Sells custom loot chests for GP.','https://mod.io/g/melvoridle/m/shoptest');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(5562257,5562257,'Mau Mod',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Mau Mod',5562257,'https://mod.io/g/melvoridle/m/mau-mod');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5562257,'resources','high','approved','Explicit Township resources, consumable preservation and God Mode. Multipliers unspecified, so XP-specific Progression is only medium confidence. No supported Time classification.','Offers Township resources and consumable preservation.','https://mod.io/g/melvoridle/m/mau-mod');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4510205,4510205,'timeIsMoney',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('timeIsMoney',4510205,'https://mod.io/g/melvoridle/m/timeismoney');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4510205,'time','high','approved','Publisher and inventory explicitly describe speeding up the game.','Publisher and inventory explicitly describe speeding up the game.','https://mod.io/g/melvoridle/m/timeismoney');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2647058,2647058,'X  Auto Manger',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('X  Auto Manger',2647058,'https://mod.io/g/melvoridle/m/x-auto-manger');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2647058,'resources','high','approved','Explicit item/currency/prayer-point adders, XP and Mastery XP additions, XP multiplier and automatic Slayer tasks. XP speed is not game-time acceleration.','Offers item, currency and prayer-point adders.','https://mod.io/g/melvoridle/m/x-auto-manger');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(5964319,5964319,'Melvor Cheat Suite',1);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Melvor Cheat Suite',5964319,'https://mod.io/g/melvoridle/m/melvor-cheat-suite');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5964319,'items','high','approved','Historical eight-mod Interdict policy membership; loaded presence does not establish use.','Included in the historical eight-mod Item Cheats policy.','https://mod.io/g/melvoridle/m/melvor-cheat-suite');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4854748,4854748,'Progressive offline speedup',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Progressive offline speedup',4854748,'https://mod.io/g/melvoridle/m/progressive-offline-speedup2');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4854748,'time','high','approved','Multiplies simulated offline elapsed time.','Multiplies simulated offline elapsed time.','https://mod.io/g/melvoridle/m/progressive-offline-speedup2');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6328604,6328604,'宠物加强版',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('宠物加强版',6328604,'https://mod.io/g/melvoridle/m/na256951');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6328604,'loot_rng','high','approved','Chinese description explicitly offers pet acquisition probability multipliers and rare-drop probability/quantity boosts. Stacked pet bonuses can affect combat/progression; inspect exact bonuses before those mappings become public.','Offers pet acquisition and rare-drop probability boosts.','https://mod.io/g/melvoridle/m/na256951');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6328604,'resources','medium','pending','Chinese description explicitly offers pet acquisition probability multipliers and rare-drop probability/quantity boosts. Stacked pet bonuses can affect combat/progression; inspect exact bonuses before those mappings become public.','','https://mod.io/g/melvoridle/m/na256951');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2592412,2592412,'Buyable Dungeon Chests',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Buyable Dungeon Chests',2592412,'https://mod.io/g/melvoridle/m/buyable-dungeon-chests');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2592412,'shops','high','approved','Purchasable dungeon chests/scrolls after explicit completion gates; not itself a reroll mod.','Purchasable dungeon chests/scrolls after explicit completion gates.','https://mod.io/g/melvoridle/m/buyable-dungeon-chests');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2404399,2404399,'Gotta Go Fast',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Gotta Go Fast',2404399,'https://mod.io/g/melvoridle/m/gotta-go-fast');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2404399,'time','high','approved','Changes game tick multiplier.','Changes game tick multiplier.','https://mod.io/g/melvoridle/m/gotta-go-fast');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2920542,2920542,'Rune Shop for TotH',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Rune Shop for TotH',2920542,'https://mod.io/g/melvoridle/m/rune-shop-for-toth');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2920542,'shops','high','approved','Sells TotH runes and a rune chest; level requirement retained. Random chest alone does not establish RNG manipulation.','Sells TotH runes and a rune chest.','https://mod.io/g/melvoridle/m/rune-shop-for-toth');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2674875,2674875,'Slayer Coin Multiplier',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Slayer Coin Multiplier',2674875,'https://mod.io/g/melvoridle/m/slayer-coin-multiplier');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2674875,'resources','high','approved','Multiplies Slayer Coin gains; listing default is 10x.','Multiplies Slayer Coin gains.','https://mod.io/g/melvoridle/m/slayer-coin-multiplier');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4075906,4075906,'Buyable Dungon Chest Updated',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Buyable Dungon Chest Updated',4075906,'https://mod.io/g/melvoridle/m/buyable-dungon-chest-updated');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4075906,'shops','high','approved','Adds further DLC chest shops to original purchasable-dungeon-chest model.','Adds further DLC chest shops to original purchasable-dungeon-chest model.','https://mod.io/g/melvoridle/m/buyable-dungon-chest-updated');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6379230,6379230,'Cheat Chest',1);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Cheat Chest',6379230,'https://mod.io/g/melvoridle/m/cheat-chest');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6379230,'items','high','approved','Historical eight-mod Interdict policy membership; loaded presence does not establish use.','Included in the historical eight-mod Item Cheats policy.','https://mod.io/g/melvoridle/m/cheat-chest');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6379230,'loot_rng','high','approved','Equalizes weights, limits outcomes to chosen items and forces maximum normal quantity. Existing Interdict member.','Changes chest outcome weights and allows chosen items.','https://mod.io/g/melvoridle/m/cheat-chest');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6379230,'resources','high','approved','Equalizes weights, limits outcomes to chosen items and forces maximum normal quantity. Existing Interdict member.','Can force the maximum normal chest quantity.','https://mod.io/g/melvoridle/m/cheat-chest');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(3736954,3736954,'Quicksave and Quickload (Reroll offline progress)',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Quicksave and Quickload (Reroll offline progress)',3736954,'https://mod.io/g/melvoridle/m/quicksave-quickload');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(3736954,'loot_rng','high','approved','Restoring saves rerolls simulated offline rewards. Does not establish extra elapsed-time creation; separate from rollback-economy incident detection.','Restoring saves rerolls simulated offline rewards.','https://mod.io/g/melvoridle/m/quicksave-quickload');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6399063,6399063,'kunkun的神秘商店',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('kunkun的神秘商店',6399063,'https://mod.io/g/melvoridle/m/buybuck');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6399063,'shops','high','approved','Chinese description: shop buys back previously sold items, with shortcut purchasing from some icons. Prices/exploitability not established.','Adds a shop for repurchasing previously sold items.','https://mod.io/g/melvoridle/m/buybuck');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6226897,6226897,'Lucky Reroll (animations removed)',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Lucky Reroll (animations removed)',6226897,'https://mod.io/g/melvoridle/m/lucky-reroll-animations-removed');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6226897,'loot_rng','high','approved','Chest-reroll fork with animations removed.','Chest-reroll fork with animations removed.','https://mod.io/g/melvoridle/m/lucky-reroll-animations-removed');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4610188,4610188,'more time skip',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('more time skip',4610188,'https://mod.io/g/melvoridle/m/more-time-skip');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4610188,'time','high','approved','Additional time-skip options; supported by inventory and publisher summary.','Additional time-skip options.','https://mod.io/g/melvoridle/m/more-time-skip');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4210503,4210503,'Remove Consumptions',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Remove Consumptions',4210503,'https://mod.io/g/melvoridle/m/remove-consumptions');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4210503,'resources','high','approved','100-percent preservation of selected ammo, runes, food, prayer/soul points, tablets, consumables and potion charges. Potion selection still consumes one potion.','100-percent preservation of selected ammo, runes, food, prayer/soul points, tablets, consumables and potion charges.','https://mod.io/g/melvoridle/m/remove-consumptions');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6155084,6155084,'2nd skill online',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('2nd skill online',6155084,'https://mod.io/g/melvoridle/m/2nd-skill-online');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6155084,'multitasking','high','approved','Additional online skill; description says no saved progress. Confirm practical compatibility before release, but category intent is explicit.','Adds a second online skill.','https://mod.io/g/melvoridle/m/2nd-skill-online');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2985491,2985491,'Free Farming',0);
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2985491,'resources','high','approved','Both distinct Free Farming listings remove action-button costs; identity is ambiguous between two mod.io IDs. Do not claim seeds are free without inspecting code. Classify both IDs independently once matched.','Removes action-button costs in farming.','https://mod.io/g/melvoridle/m/free-farming | https://mod.io/g/melvoridle/m/free-farming1');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(4791576,4791576,'Free Farming',0);
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(4791576,'resources','high','approved','Both distinct Free Farming listings remove action-button costs; identity is ambiguous between two mod.io IDs. Do not claim seeds are free without inspecting code. Classify both IDs independently once matched.','Removes action-button costs in farming.','https://mod.io/g/melvoridle/m/free-farming | https://mod.io/g/melvoridle/m/free-farming1');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(5562948,5562948,'God Mode',1);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('God Mode',5562948,'https://mod.io/g/melvoridle/m/god-mode');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(5562948,'items','high','approved','Historical eight-mod Interdict policy membership; loaded presence does not establish use.','Included in the historical eight-mod Item Cheats policy.','https://mod.io/g/melvoridle/m/god-mode');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2492054,2492054,'I hate RNG',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('I hate RNG',2492054,'https://mod.io/g/melvoridle/m/i-hate-rng');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2492054,'loot_rng','high','approved','Converts containers into selected drops at a configurable exchange rate. Deterministic conversion is explicit even at default expected-value pricing.','Converts containers into selected drops at a configurable exchange rate.','https://mod.io/g/melvoridle/m/i-hate-rng');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6404219,6404219,'ingot shop',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('ingot shop',6404219,'https://mod.io/g/melvoridle/m/bars-shop');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6404219,'shops','high','approved','Chinese description: ingots sold at their sell price.','ingots sold at their sell price.','https://mod.io/g/melvoridle/m/bars-shop');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(2476421,2476421,'Melvor Clicker',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('Melvor Clicker',2476421,'https://mod.io/g/melvoridle/m/melvor-clicker');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(2476421,'time','high','approved','Clicks subtract active non-combat action ticks.','Clicks subtract active non-combat action ticks.','https://mod.io/g/melvoridle/m/melvor-clicker');
INSERT INTO mod_catalog(id,mod_io_id,canonical_name,legacy_interdict_member) VALUES(6404239,6404239,'wood shop',0);
INSERT INTO mod_catalog_aliases(alias,mod_catalog_id,evidence_reference) VALUES('wood shop',6404239,'https://mod.io/g/melvoridle/m/wood-shop');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6404239,'shops','high','approved','Chinese description: all wood sold at its sell price.','all wood sold at its sell price.','https://mod.io/g/melvoridle/m/wood-shop');
INSERT INTO mod_catalog VALUES(6419494,6419494,'Universal Item Spawner',1);
INSERT INTO mod_catalog_aliases VALUES('Universal Item Spawner',6419494,'legacy server registry');
INSERT INTO mod_category_classifications(mod_catalog_id,category_id,confidence,publication_state,rationale,public_explanation,evidence_reference) VALUES(6419494,'items','high','approved','Historical eight-mod Interdict policy membership; loaded presence does not establish use.','Included in the historical eight-mod Item Cheats policy.','legacy server registry');
-- Existing named legacy detections retain their own timestamps and legacy matching semantics.
INSERT INTO client_mod_observations
SELECT d.client_id,m.id,d.detected_at,d.mod_name,d.mod_id,
 CASE WHEN d.mod_id IS NULL THEN 'legacy_policy' ELSE 'mod_io_id' END,'legacy_detection'
FROM client_cheat_mod_detections d JOIN mod_catalog m ON m.legacy_interdict_member=1 AND
 (d.mod_id=m.mod_io_id OR (d.mod_id IS NULL AND EXISTS(SELECT 1 FROM mod_catalog_aliases a WHERE a.alias=d.mod_name AND a.mod_catalog_id=m.id)))
WHERE true
ON CONFLICT(client_id,mod_catalog_id) DO UPDATE SET last_observed_at=MAX(last_observed_at,excluded.last_observed_at);
-- Only the surviving latest snapshot exists. Explicit null/conflicting metadata never becomes a new title match.
INSERT INTO client_mod_observations
SELECT r.client_id,m.id,r.reported_at,n.value,
 (SELECT json_extract(d.value,'$.id') FROM json_each(r.active_mod_details) d WHERE json_extract(d.value,'$.name')=n.value LIMIT 1),
 CASE WHEN EXISTS(SELECT 1 FROM json_each(r.active_mod_details) d WHERE json_extract(d.value,'$.name')=n.value) THEN 'mod_io_id' ELSE 'curated_name' END,'snapshot'
FROM client_runtime_snapshots r,json_each(r.active_mods) n JOIN mod_catalog m ON
 (EXISTS(SELECT 1 FROM json_each(r.active_mod_details) d WHERE json_extract(d.value,'$.name')=n.value AND json_extract(d.value,'$.id')=m.mod_io_id)
 AND NOT EXISTS(SELECT 1 FROM json_each(r.active_mod_details) d WHERE json_extract(d.value,'$.name')=n.value AND json_extract(d.value,'$.id') IS NOT m.mod_io_id))
 OR (NOT EXISTS(SELECT 1 FROM json_each(r.active_mod_details) d WHERE json_extract(d.value,'$.name')=n.value)
 AND EXISTS(SELECT 1 FROM mod_catalog_aliases a WHERE a.alias=n.value AND a.mod_catalog_id=m.id))
WHERE true
ON CONFLICT(client_id,mod_catalog_id) DO UPDATE SET
 last_observed_at=excluded.last_observed_at,reported_name=excluded.reported_name,
 reported_mod_io_id=excluded.reported_mod_io_id,match_method=excluded.match_method,evidence_source=excluded.evidence_source
WHERE excluded.last_observed_at>client_mod_observations.last_observed_at;

`
};
