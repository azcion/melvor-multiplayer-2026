const CAMPAIGN_ITEM_GP_VALUES: Record<string, number> = {
	'melvorD:Topaz': 225, 'melvorD:Sapphire': 335, 'melvorD:Ruby': 555, 'melvorD:Emerald': 555,
	'melvorD:Diamond': 1150, 'melvorD:Silver_Bar': 51, 'melvorD:Gold_Bar': 142,
	'melvorF:Small_Urn': 250, 'melvorF:Medium_Urn': 550,
	'melvorD:Rune_Essence': 0, 'melvorD:Air_Rune': 1, 'melvorD:Mind_Rune': 1, 'melvorD:Water_Rune': 1,
	'melvorD:Earth_Rune': 1, 'melvorD:Fire_Rune': 2, 'melvorD:Body_Rune': 2, 'melvorD:Chaos_Rune': 3,
	'melvorD:Death_Rune': 4, 'melvorD:Blood_Rune': 4, 'melvorD:Ancient_Rune': 5,
	'melvorD:Raw_Shrimp': 1, 'melvorD:Raw_Sardine': 3, 'melvorD:Raw_Herring': 8, 'melvorD:Raw_Trout': 16,
	'melvorD:Raw_Salmon': 35, 'melvorD:Raw_Lobster': 65, 'melvorD:Raw_Swordfish': 80,
	'melvorD:Raw_Crab': 135, 'melvorD:Raw_Shark': 270, 'melvorD:Raw_Cave_Fish': 215,
	'melvorD:Raw_Manta_Ray': 650, 'melvorD:Raw_Whale': 750,
	'melvorD:Shrimp': 2, 'melvorD:Sardine': 5, 'melvorD:Herring': 10, 'melvorD:Trout': 27,
	'melvorD:Salmon': 58, 'melvorD:Lobster': 108, 'melvorD:Swordfish': 134, 'melvorD:Crab': 280,
	'melvorD:Shark': 674, 'melvorD:Cave_Fish': 538, 'melvorD:Manta_Ray': 1624, 'melvorD:Whale': 2048,
	'melvorF:Poraxx_Herb': 150, 'melvorF:Pigtayle_Herb': 210, 'melvorF:Barrentoe_Herb': 330,
	'melvorF:Poraxx_Seed': 190, 'melvorF:Pigtayle_Seed': 222, 'melvorF:Barrentoe_Seed': 450,
	'melvorD:Garum_Herb': 1, 'melvorD:Sourweed_Herb': 9, 'melvorD:Mantalyme_Herb': 20,
	'melvorD:Lemontyle_Herb': 40, 'melvorD:Oxilyme_Herb': 80, 'melvorD:Garum_Seed': 3,
	'melvorD:Sourweed_Seed': 20, 'melvorD:Mantalyme_Seed': 62, 'melvorD:Lemontyle_Seed': 88,
	'melvorD:Oxilyme_Seed': 140, 'melvorD:Potato_Seed': 1, 'melvorD:Onion_Seed': 5,
	'melvorD:Cabbage_Seed': 10, 'melvorD:Tomato_Seed': 20, 'melvorD:Sweetcorn_Seed': 30,
	'melvorD:Strawberry_Seed': 40, 'melvorD:Watermelon_Seed': 50, 'melvorD:Snape_Grass_Seed': 75,
	'melvorD:Bird_Nest': 350,
	'melvorD:Bones': 5, 'melvorD:Dragon_Bones': 200, 'melvorD:Magic_Bones': 300, 'melvorD:Big_Bones': 13,
	'melvorD:Bronze_Arrows': 1, 'melvorD:Iron_Arrows': 2, 'melvorD:Steel_Arrows': 3,
	'melvorD:Mithril_Arrows': 8, 'melvorD:Adamant_Arrows': 10, 'melvorD:Rune_Arrows': 30,
	'melvorD:Dragon_Arrows': 45, 'melvorD:Bronze_Arrowtips': 1, 'melvorD:Iron_Arrowtips': 1,
	'melvorD:Steel_Arrowtips': 1, 'melvorD:Mithril_Arrowtips': 1, 'melvorD:Adamant_Arrowtips': 1,
	'melvorD:Rune_Arrowtips': 1, 'melvorD:Dragon_Arrowtips': 1,
	'melvorD:Normal_Logs': 1, 'melvorD:Oak_Logs': 5, 'melvorD:Willow_Logs': 10, 'melvorD:Teak_Logs': 20,
	'melvorD:Maple_Logs': 35, 'melvorD:Mahogany_Logs': 50, 'melvorD:Yew_Logs': 75,
	'melvorD:Magic_Logs': 400, 'melvorD:Redwood_Logs': 25,
	'melvorD:Copper_Ore': 2, 'melvorD:Tin_Ore': 2, 'melvorD:Iron_Ore': 5, 'melvorD:Coal_Ore': 13,
	'melvorD:Silver_Ore': 25, 'melvorD:Gold_Ore': 30, 'melvorD:Mithril_Ore': 65,
	'melvorD:Adamantite_Ore': 88, 'melvorD:Runite_Ore': 100, 'melvorD:Dragonite_Ore': 135,
	'melvorF:Ash': 5
};

export function get_campaign_item_gp_value(item_id: string): number | null {
	return CAMPAIGN_ITEM_GP_VALUES[item_id] ?? null;
}

export function get_campaign_item_gp_values(): Readonly<Record<string, number>> {
	return CAMPAIGN_ITEM_GP_VALUES;
}
