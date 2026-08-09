export type CampaignData = {
	id: string;
	items: CampaignItemData[];
}

export type CampaignItemData = {
	id: string;
	estimated_12h_output: number;
}

// Ballpark mid-game output for one player over 12 hours; campaign creation applies friendly upward rounding.
export const AVAILABLE_CAMPAIGNS = [
	{
		id: 'campaign_desert',
		items: [
			{ id: 'melvorD:Topaz', estimated_12h_output: 1500 },
			{ id: 'melvorD:Sapphire', estimated_12h_output: 1200 },
			{ id: 'melvorD:Ruby', estimated_12h_output: 1000 },
			{ id: 'melvorD:Emerald', estimated_12h_output: 900 },
			{ id: 'melvorD:Diamond', estimated_12h_output: 700 },
			{ id: 'melvorD:Silver_Bar', estimated_12h_output: 25920 },
			{ id: 'melvorD:Gold_Bar', estimated_12h_output: 25920 },
			{ id: 'melvorF:Small_Urn', estimated_12h_output: 21600 },
			{ id: 'melvorF:Medium_Urn', estimated_12h_output: 17280 }
		]
	},
	{
		id: 'campaign_snow',
		items: [
			{ id: 'melvorD:Rune_Essence', estimated_12h_output: 17280 },
			{ id: 'melvorD:Air_Rune', estimated_12h_output: 400000 },
			{ id: 'melvorD:Mind_Rune', estimated_12h_output: 300000 },
			{ id: 'melvorD:Water_Rune', estimated_12h_output: 250000 },
			{ id: 'melvorD:Earth_Rune', estimated_12h_output: 200000 },
			{ id: 'melvorD:Fire_Rune', estimated_12h_output: 180000 },
			{ id: 'melvorD:Body_Rune', estimated_12h_output: 150000 },
			{ id: 'melvorD:Chaos_Rune', estimated_12h_output: 100000 },
			{ id: 'melvorD:Death_Rune', estimated_12h_output: 80000 },
			{ id: 'melvorD:Blood_Rune', estimated_12h_output: 60000 },
			{ id: 'melvorD:Ancient_Rune', estimated_12h_output: 40000 },
			{ id: 'melvorD:Raw_Shrimp', estimated_12h_output: 20000 },
			{ id: 'melvorD:Raw_Sardine', estimated_12h_output: 18000 },
			{ id: 'melvorD:Raw_Herring', estimated_12h_output: 18000 },
			{ id: 'melvorD:Raw_Trout', estimated_12h_output: 15000 },
			{ id: 'melvorD:Raw_Salmon', estimated_12h_output: 12000 },
			{ id: 'melvorD:Raw_Lobster', estimated_12h_output: 10000 },
			{ id: 'melvorD:Raw_Swordfish', estimated_12h_output: 9000 },
			{ id: 'melvorD:Raw_Crab', estimated_12h_output: 8000 },
			{ id: 'melvorD:Raw_Shark', estimated_12h_output: 6000 },
			{ id: 'melvorD:Raw_Cave_Fish', estimated_12h_output: 5000 },
			{ id: 'melvorD:Raw_Manta_Ray', estimated_12h_output: 4000 },
			{ id: 'melvorD:Raw_Whale', estimated_12h_output: 3000 },
			{ id: 'melvorD:Shrimp', estimated_12h_output: 20000 },
			{ id: 'melvorD:Sardine', estimated_12h_output: 18000 },
			{ id: 'melvorD:Herring', estimated_12h_output: 18000 },
			{ id: 'melvorD:Trout', estimated_12h_output: 15000 },
			{ id: 'melvorD:Salmon', estimated_12h_output: 12000 },
			{ id: 'melvorD:Lobster', estimated_12h_output: 10000 },
			{ id: 'melvorD:Swordfish', estimated_12h_output: 9000 },
			{ id: 'melvorD:Crab', estimated_12h_output: 8000 },
			{ id: 'melvorD:Shark', estimated_12h_output: 6000 },
			{ id: 'melvorD:Cave_Fish', estimated_12h_output: 5000 },
			{ id: 'melvorD:Manta_Ray', estimated_12h_output: 4000 },
			{ id: 'melvorD:Whale', estimated_12h_output: 3000 }
		]
	},
	{
		id: 'campaign_forest',
		items: [
			{ id: 'melvorF:Poraxx_Herb', estimated_12h_output: 2000 },
			{ id: 'melvorF:Pigtayle_Herb', estimated_12h_output: 1800 },
			{ id: 'melvorF:Barrentoe_Herb', estimated_12h_output: 1500 },
			{ id: 'melvorF:Poraxx_Seed', estimated_12h_output: 200 },
			{ id: 'melvorF:Pigtayle_Seed', estimated_12h_output: 180 },
			{ id: 'melvorF:Barrentoe_Seed', estimated_12h_output: 150 },
			{ id: 'melvorD:Garum_Herb', estimated_12h_output: 5000 },
			{ id: 'melvorD:Sourweed_Herb', estimated_12h_output: 4500 },
			{ id: 'melvorD:Mantalyme_Herb', estimated_12h_output: 4000 },
			{ id: 'melvorD:Lemontyle_Herb', estimated_12h_output: 3500 },
			{ id: 'melvorD:Oxilyme_Herb', estimated_12h_output: 3000 },
			{ id: 'melvorD:Garum_Seed', estimated_12h_output: 800 },
			{ id: 'melvorD:Sourweed_Seed', estimated_12h_output: 700 },
			{ id: 'melvorD:Mantalyme_Seed', estimated_12h_output: 600 },
			{ id: 'melvorD:Lemontyle_Seed', estimated_12h_output: 500 },
			{ id: 'melvorD:Oxilyme_Seed', estimated_12h_output: 400 },
			{ id: 'melvorD:Potato_Seed', estimated_12h_output: 1500 },
			{ id: 'melvorD:Onion_Seed', estimated_12h_output: 1200 },
			{ id: 'melvorD:Cabbage_Seed', estimated_12h_output: 1000 },
			{ id: 'melvorD:Tomato_Seed', estimated_12h_output: 900 },
			{ id: 'melvorD:Sweetcorn_Seed', estimated_12h_output: 800 },
			{ id: 'melvorD:Strawberry_Seed', estimated_12h_output: 700 },
			{ id: 'melvorD:Watermelon_Seed', estimated_12h_output: 600 },
			{ id: 'melvorD:Snape_Grass_Seed', estimated_12h_output: 500 },
			{ id: 'melvorD:Bird_Nest', estimated_12h_output: 2000 }
		]
	},
	{
		id: 'campaign_forsaken',
		items: [
			{ id: 'melvorD:Bones', estimated_12h_output: 20000 },
			{ id: 'melvorD:Dragon_Bones', estimated_12h_output: 2000 },
			{ id: 'melvorD:Magic_Bones', estimated_12h_output: 5000 },
			{ id: 'melvorD:Big_Bones', estimated_12h_output: 10000 },
			{ id: 'melvorD:Bronze_Arrows', estimated_12h_output: 388800 },
			{ id: 'melvorD:Iron_Arrows', estimated_12h_output: 388800 },
			{ id: 'melvorD:Steel_Arrows', estimated_12h_output: 388800 },
			{ id: 'melvorD:Mithril_Arrows', estimated_12h_output: 388800 },
			{ id: 'melvorD:Adamant_Arrows', estimated_12h_output: 388800 },
			{ id: 'melvorD:Rune_Arrows', estimated_12h_output: 388800 },
			{ id: 'melvorD:Dragon_Arrows', estimated_12h_output: 388800 },
			{ id: 'melvorD:Bronze_Arrowtips', estimated_12h_output: 388800 },
			{ id: 'melvorD:Iron_Arrowtips', estimated_12h_output: 388800 },
			{ id: 'melvorD:Steel_Arrowtips', estimated_12h_output: 388800 },
			{ id: 'melvorD:Mithril_Arrowtips', estimated_12h_output: 388800 },
			{ id: 'melvorD:Adamant_Arrowtips', estimated_12h_output: 388800 },
			{ id: 'melvorD:Rune_Arrowtips', estimated_12h_output: 388800 },
			{ id: 'melvorD:Dragon_Arrowtips', estimated_12h_output: 388800 }
		]
	},
	{
		id: 'campaign_jungle',
		items: [
			{ id: 'melvorD:Normal_Logs', estimated_12h_output: 20000 },
			{ id: 'melvorD:Oak_Logs', estimated_12h_output: 18000 },
			{ id: 'melvorD:Willow_Logs', estimated_12h_output: 16000 },
			{ id: 'melvorD:Teak_Logs', estimated_12h_output: 14000 },
			{ id: 'melvorD:Maple_Logs', estimated_12h_output: 12000 },
			{ id: 'melvorD:Mahogany_Logs', estimated_12h_output: 10000 },
			{ id: 'melvorD:Yew_Logs', estimated_12h_output: 8000 },
			{ id: 'melvorD:Magic_Logs', estimated_12h_output: 6000 },
			{ id: 'melvorD:Redwood_Logs', estimated_12h_output: 5000 }
		]
	},
	{
		id: 'campaign_volcanic',
		items: [
			{ id: 'melvorD:Copper_Ore', estimated_12h_output: 20000 },
			{ id: 'melvorD:Tin_Ore', estimated_12h_output: 20000 },
			{ id: 'melvorD:Iron_Ore', estimated_12h_output: 18000 },
			{ id: 'melvorD:Coal_Ore', estimated_12h_output: 20000 },
			{ id: 'melvorD:Silver_Ore', estimated_12h_output: 15000 },
			{ id: 'melvorD:Gold_Ore', estimated_12h_output: 12000 },
			{ id: 'melvorD:Mithril_Ore', estimated_12h_output: 10000 },
			{ id: 'melvorD:Adamantite_Ore', estimated_12h_output: 8000 },
			{ id: 'melvorD:Runite_Ore', estimated_12h_output: 6000 },
			{ id: 'melvorD:Dragonite_Ore', estimated_12h_output: 5000 },
			{ id: 'melvorF:Ash', estimated_12h_output: 15000 }
		]
	}
];
