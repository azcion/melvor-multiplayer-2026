export const topology = {
	"chambers": [
		{
			"id": "entrance",
			"label": "The Rift",
			"depth": 0,
			"type": "start",
			"exits": [
				{
					"id": "entrance:exit_1",
					"slot": 1,
					"target": "prismatic_descent"
				},
				{
					"id": "entrance:exit_2",
					"slot": 2,
					"target": "drowned_cloister"
				},
				{
					"id": "entrance:exit_3",
					"slot": 3,
					"target": "rootforge_passage"
				}
			]
		},
		{
			"id": "prismatic_descent",
			"label": "Prismatic Descent",
			"depth": 1,
			"type": "chamber",
			"exits": [
				{
					"id": "prismatic_descent:exit_1",
					"slot": 1,
					"target": "glassroot_terraces"
				},
				{
					"id": "prismatic_descent:exit_2",
					"slot": 2,
					"target": "tideworn_crypts"
				},
				{
					"id": "prismatic_descent:exit_3",
					"slot": 3,
					"target": "embervein_machinery"
				}
			]
		},
		{
			"id": "drowned_cloister",
			"label": "Drowned Cloister",
			"depth": 1,
			"type": "chamber",
			"exits": [
				{
					"id": "drowned_cloister:exit_1",
					"slot": 1,
					"target": "tideworn_crypts"
				},
				{
					"id": "drowned_cloister:exit_2",
					"slot": 2,
					"target": "mossbound_reliquary"
				}
			]
		},
		{
			"id": "rootforge_passage",
			"label": "Rootforge Passage",
			"depth": 1,
			"type": "chamber",
			"exits": [
				{
					"id": "rootforge_passage:exit_1",
					"slot": 1,
					"target": "glassroot_terraces"
				}
			]
		},
		{
			"id": "glassroot_terraces",
			"label": "Glassroot Terraces",
			"depth": 2,
			"type": "chamber",
			"exits": [
				{
					"id": "glassroot_terraces:exit_1",
					"slot": 1,
					"target": "convergence_gallery"
				},
				{
					"id": "glassroot_terraces:exit_2",
					"slot": 2,
					"target": "spore_cathedral"
				},
				{
					"id": "glassroot_terraces:exit_3",
					"slot": 3,
					"target": "buried_observatory"
				}
			]
		},
		{
			"id": "tideworn_crypts",
			"label": "Tideworn Crypts",
			"depth": 2,
			"type": "chamber",
			"exits": [
				{
					"id": "tideworn_crypts:exit_1",
					"slot": 1,
					"target": "convergence_gallery"
				}
			]
		},
		{
			"id": "embervein_machinery",
			"label": "Embervein Machinery",
			"depth": 2,
			"type": "chamber",
			"exits": [
				{
					"id": "embervein_machinery:exit_1",
					"slot": 1,
					"target": "convergence_gallery"
				},
				{
					"id": "embervein_machinery:exit_2",
					"slot": 2,
					"target": "ashen_foundry"
				}
			]
		},
		{
			"id": "mossbound_reliquary",
			"label": "Mossbound Reliquary",
			"depth": 2,
			"type": "chamber",
			"exits": [
				{
					"id": "mossbound_reliquary:exit_1",
					"slot": 1,
					"target": "blackwater_nave"
				},
				{
					"id": "mossbound_reliquary:exit_2",
					"slot": 2,
					"target": "spore_cathedral"
				}
			]
		},
		{
			"id": "convergence_gallery",
			"label": "Convergence Gallery",
			"depth": 3,
			"type": "chamber",
			"exits": [
				{
					"id": "convergence_gallery:exit_1",
					"slot": 1,
					"target": "prismatic_orrery"
				},
				{
					"id": "convergence_gallery:exit_2",
					"slot": 2,
					"target": "drowned_basilica"
				},
				{
					"id": "convergence_gallery:exit_3",
					"slot": 3,
					"target": "cinder_engine"
				}
			]
		},
		{
			"id": "blackwater_nave",
			"label": "Blackwater Nave",
			"depth": 3,
			"type": "chamber",
			"exits": [
				{
					"id": "blackwater_nave:exit_1",
					"slot": 1,
					"target": "drowned_basilica"
				},
				{
					"id": "blackwater_nave:exit_2",
					"slot": 2,
					"target": "mycelial_court"
				}
			]
		},
		{
			"id": "ashen_foundry",
			"label": "Ashen Foundry",
			"depth": 3,
			"type": "chamber",
			"exits": [
				{
					"id": "ashen_foundry:exit_1",
					"slot": 1,
					"target": "cinder_engine"
				},
				{
					"id": "ashen_foundry:exit_2",
					"slot": 2,
					"target": "gilded_catacombs"
				}
			]
		},
		{
			"id": "spore_cathedral",
			"label": "Spore Cathedral",
			"depth": 3,
			"type": "chamber",
			"exits": [
				{
					"id": "spore_cathedral:exit_1",
					"slot": 1,
					"target": "mycelial_court"
				},
				{
					"id": "spore_cathedral:exit_2",
					"slot": 2,
					"target": "starless_sanctum"
				}
			]
		},
		{
			"id": "buried_observatory",
			"label": "Buried Observatory",
			"depth": 3,
			"type": "chamber",
			"exits": [
				{
					"id": "buried_observatory:exit_1",
					"slot": 1,
					"target": "prismatic_orrery"
				}
			]
		},
		{
			"id": "prismatic_orrery",
			"label": "Prismatic Orrery",
			"depth": 4,
			"type": "chamber",
			"exits": [
				{
					"id": "prismatic_orrery:exit_1",
					"slot": 1,
					"target": "echoing_dais"
				},
				{
					"id": "prismatic_orrery:exit_2",
					"slot": 2,
					"target": "rootcrown_nexus"
				},
				{
					"id": "prismatic_orrery:exit_3",
					"slot": 3,
					"target": "voidwatch_threshold"
				}
			]
		},
		{
			"id": "drowned_basilica",
			"label": "Drowned Basilica",
			"depth": 4,
			"type": "chamber",
			"exits": [
				{
					"id": "drowned_basilica:exit_1",
					"slot": 1,
					"target": "sunken_bell_chamber"
				}
			]
		},
		{
			"id": "cinder_engine",
			"label": "Cinder Engine",
			"depth": 4,
			"type": "chamber",
			"exits": [
				{
					"id": "cinder_engine:exit_1",
					"slot": 1,
					"target": "everflame_anvil"
				},
				{
					"id": "cinder_engine:exit_2",
					"slot": 2,
					"target": "royal_treasury"
				}
			]
		},
		{
			"id": "mycelial_court",
			"label": "Mycelial Court",
			"depth": 4,
			"type": "chamber",
			"exits": [
				{
					"id": "mycelial_court:exit_1",
					"slot": 1,
					"target": "rootcrown_nexus"
				},
				{
					"id": "mycelial_court:exit_2",
					"slot": 2,
					"target": "sunken_bell_chamber"
				}
			]
		},
		{
			"id": "gilded_catacombs",
			"label": "Gilded Catacombs",
			"depth": 4,
			"type": "chamber",
			"exits": [
				{
					"id": "gilded_catacombs:exit_1",
					"slot": 1,
					"target": "royal_treasury"
				},
				{
					"id": "gilded_catacombs:exit_2",
					"slot": 2,
					"target": "echoing_dais"
				}
			]
		},
		{
			"id": "starless_sanctum",
			"label": "Starless Sanctum",
			"depth": 4,
			"type": "chamber",
			"exits": [
				{
					"id": "starless_sanctum:exit_1",
					"slot": 1,
					"target": "voidwatch_threshold"
				},
				{
					"id": "starless_sanctum:exit_2",
					"slot": 2,
					"target": "echoing_dais"
				}
			]
		},
		{
			"id": "echoing_dais",
			"label": "Echoing Dais",
			"depth": 5,
			"type": "chamber",
			"exits": [
				{
					"id": "echoing_dais:exit_1",
					"slot": 1,
					"target": "crown_of_echoes"
				}
			]
		},
		{
			"id": "everflame_anvil",
			"label": "Everflame Anvil",
			"depth": 5,
			"type": "chamber",
			"exits": [
				{
					"id": "everflame_anvil:exit_1",
					"slot": 1,
					"target": "everforge"
				}
			]
		},
		{
			"id": "sunken_bell_chamber",
			"label": "Sunken Bell Chamber",
			"depth": 5,
			"type": "chamber",
			"exits": [
				{
					"id": "sunken_bell_chamber:exit_1",
					"slot": 1,
					"target": "bell_below"
				}
			]
		},
		{
			"id": "rootcrown_nexus",
			"label": "Rootcrown Nexus",
			"depth": 5,
			"type": "chamber",
			"exits": [
				{
					"id": "rootcrown_nexus:exit_1",
					"slot": 1,
					"target": "verdant_sovereign"
				}
			]
		},
		{
			"id": "royal_treasury",
			"label": "Royal Treasury",
			"depth": 5,
			"type": "chamber",
			"exits": [
				{
					"id": "royal_treasury:exit_1",
					"slot": 1,
					"target": "vault_of_first_kings"
				}
			]
		},
		{
			"id": "voidwatch_threshold",
			"label": "Voidwatch Threshold",
			"depth": 5,
			"type": "chamber",
			"exits": [
				{
					"id": "voidwatch_threshold:exit_1",
					"slot": 1,
					"target": "hollow_star"
				}
			]
		},
		{
			"id": "crown_of_echoes",
			"label": "The Crown of Echoes",
			"depth": 6,
			"type": "ending",
			"exits": []
		},
		{
			"id": "everforge",
			"label": "The Everforge",
			"depth": 6,
			"type": "ending",
			"exits": []
		},
		{
			"id": "bell_below",
			"label": "The Bell Below",
			"depth": 6,
			"type": "ending",
			"exits": []
		},
		{
			"id": "verdant_sovereign",
			"label": "The Verdant Sovereign",
			"depth": 6,
			"type": "ending",
			"exits": []
		},
		{
			"id": "vault_of_first_kings",
			"label": "Vault of the First Kings",
			"depth": 6,
			"type": "ending",
			"exits": []
		},
		{
			"id": "hollow_star",
			"label": "The Hollow Star",
			"depth": 6,
			"type": "ending",
			"exits": []
		}
	]
};
export const supported_versions = {
	"1": [
		"entrance",
		"prismatic_descent",
		"drowned_cloister",
		"rootforge_passage",
		"glassroot_terraces",
		"tideworn_crypts",
		"embervein_machinery",
		"mossbound_reliquary",
		"convergence_gallery",
		"blackwater_nave",
		"ashen_foundry",
		"spore_cathedral",
		"buried_observatory",
		"prismatic_orrery",
		"drowned_basilica",
		"cinder_engine",
		"mycelial_court",
		"gilded_catacombs",
		"starless_sanctum",
		"echoing_dais",
		"everflame_anvil",
		"sunken_bell_chamber",
		"rootcrown_nexus",
		"royal_treasury",
		"voidwatch_threshold",
		"crown_of_echoes",
		"everforge",
		"bell_below",
		"verdant_sovereign",
		"vault_of_first_kings",
		"hollow_star"
	],
	"2": [
		"entrance",
		"prismatic_descent",
		"drowned_cloister",
		"rootforge_passage",
		"glassroot_terraces",
		"tideworn_crypts",
		"embervein_machinery",
		"mossbound_reliquary",
		"convergence_gallery",
		"blackwater_nave",
		"ashen_foundry",
		"spore_cathedral",
		"buried_observatory",
		"prismatic_orrery",
		"drowned_basilica",
		"cinder_engine",
		"mycelial_court",
		"gilded_catacombs",
		"starless_sanctum",
		"echoing_dais",
		"everflame_anvil",
		"sunken_bell_chamber",
		"rootcrown_nexus",
		"royal_treasury",
		"voidwatch_threshold",
		"crown_of_echoes",
		"everforge",
		"bell_below",
		"verdant_sovereign",
		"vault_of_first_kings",
		"hollow_star"
	],
	"3": [
		"entrance",
		"prismatic_descent",
		"drowned_cloister",
		"rootforge_passage",
		"glassroot_terraces",
		"tideworn_crypts",
		"embervein_machinery",
		"mossbound_reliquary",
		"buried_observatory",
		"prismatic_orrery",
		"voidwatch_threshold",
		"hollow_star"
	]
};
