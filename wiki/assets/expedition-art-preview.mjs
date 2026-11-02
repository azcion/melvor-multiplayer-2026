const chambers=[
	{
		"id": "entrance",
		"label": "The Rift",
		"depth": 0,
		"art": "https://cdn.melvor.azcn.io/assets/2df63460253b4232/entrance.png",
		"status": "Integrated artwork",
		"existing": true,
		"tagline": "The journey begins",
		"description": "A frozen threshold opening onto the branching underground journey.",
		"effects": "Existing snowfall overlay.",
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart The Rift",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Scout The Rift",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Build a camp",
				"status": "Required",
				"skills": "Firemaking / Smithing / Crafting",
				"detail": "Existing authored task · 10 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Explore the chamber",
				"status": "Optional",
				"skills": "Thieving / Agility / Combat",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Scout a passage",
				"status": "Optional",
				"skills": "Woodcutting / Mining / Cartography",
				"detail": "Existing authored task · 4 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the first passage",
				"status": "Conditional",
				"skills": "Woodcutting / Mining / Combat",
				"detail": "Existing authored task · 4 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Scout a passage",
				"status": "Optional",
				"skills": "Fishing / Herblore / Archaeology",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the second passage",
				"status": "Conditional",
				"skills": "Woodcutting / Mining / Combat",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Scout a passage",
				"status": "Optional",
				"skills": "Runecrafting / Alt. Magic / Harvesting",
				"detail": "Existing authored task · 16 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the third passage",
				"status": "Conditional",
				"skills": "Woodcutting / Mining / Combat",
				"detail": "Existing authored task · 16 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Gather supplies",
				"status": "Optional",
				"skills": "Woodcutting / Fishing / Mining",
				"detail": "Existing authored task · 20 baseline hours"
			}
		],
		"exits": [
			{
				"id": "prismatic_descent",
				"label": "Prismatic Descent",
				"supported": true
			},
			{
				"id": "drowned_cloister",
				"label": "Drowned Cloister",
				"supported": true
			},
			{
				"id": "rootforge_passage",
				"label": "Rootforge Passage",
				"supported": true
			}
		]
	},
	{
		"id": "prismatic_descent",
		"label": "Prismatic Descent",
		"depth": 1,
		"art": "https://cdn.melvor.azcn.io/assets/0526c8c90043f4c7/prismatic-descent.png",
		"status": "Re-art concept",
		"existing": true,
		"tagline": "Cold light. Impossible depth.",
		"description": "Enormous cyan crystals illuminate weathered stairs and a suspended stone bridge across an immense blue chasm. Original layout, richer architectural rendering.",
		"effects": "Reuse the current cyan motes and crystal glints. Major clusters remain in similar positions; several individual facet anchors will likely need a small remap. Alignment is not yet verified with the renderer.",
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Prismatic Descent",
				"status": "Required",
				"skills": "Summoning / Combat / Cartography",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Scout Prismatic Descent",
				"status": "Required",
				"skills": "Summoning / Combat / Cartography",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Construct a hoist",
				"status": "Required",
				"skills": "Smithing / Fletching / Crafting",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Explore the chamber",
				"status": "Optional",
				"skills": "Combat / Archaeology / Cartography",
				"detail": "Existing authored task · 12 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Trace the first passage",
				"status": "Optional",
				"skills": "Firemaking / Runecrafting / Alt. Magic",
				"detail": "Existing authored task · 6 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the first passage",
				"status": "Conditional",
				"skills": "Woodcutting / Alt. Magic / Combat",
				"detail": "Existing authored task · 4 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Trace the second passage",
				"status": "Optional",
				"skills": "Firemaking / Runecrafting / Astrology",
				"detail": "Existing authored task · 12 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the second passage",
				"status": "Conditional",
				"skills": "Woodcutting / Combat / Harvesting",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Trace the third passage",
				"status": "Optional",
				"skills": "Firemaking / Runecrafting / Summoning",
				"detail": "Existing authored task · 24 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the third passage",
				"status": "Conditional",
				"skills": "Summoning / Combat / Harvesting",
				"detail": "Existing authored task · 16 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Attune crystals",
				"status": "Optional",
				"skills": "Smithing / Runecrafting / Alt. Magic",
				"detail": "Existing authored task · 20 baseline hours"
			}
		],
		"exits": [
			{
				"id": "glassroot_terraces",
				"label": "Glassroot Terraces",
				"supported": true
			},
			{
				"id": "tideworn_crypts",
				"label": "Tideworn Crypts",
				"supported": true
			},
			{
				"id": "embervein_machinery",
				"label": "Embervein Machinery",
				"supported": true
			}
		],
		"originalArt": "https://cdn.melvor.azcn.io/assets/0e7e535382e053b1/prismatic-descent.png"
	},
	{
		"id": "drowned_cloister",
		"label": "Drowned Cloister",
		"depth": 1,
		"art": "https://cdn.melvor.azcn.io/assets/1466f55e43f0c690/drowned-cloister.png",
		"status": "Re-art concept",
		"existing": false,
		"tagline": "A sanctuary beneath still water",
		"description": "Flooded vaulted halls, half-submerged stairs and monumental columns. Teal reflections and pale stone; peaceful, but difficult to traverse. Re-arted from the existing study to match the new collection.",
		"effects": "Proposed: restrained water shimmer and a few falling droplets. Keep the architecture still.",
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Drowned Cloister",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Charting task."
			},
			{
				"phase": "arrival",
				"title": "Scout Drowned Cloister",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Scouting task."
			},
			{
				"phase": "arrival",
				"title": "Establish dry footing",
				"status": "Required",
				"skills": "Crafting / Smithing / Agility",
				"detail": "Repair supports and mark safe landing places."
			},
			{
				"phase": "exploration",
				"title": "Restore the crossing",
				"status": "Required",
				"skills": "Crafting / Smithing / Fletching",
				"detail": "Brace a broken walkway above the flooded floor."
			},
			{
				"phase": "exploration",
				"title": "Study the flooded galleries",
				"status": "Optional",
				"skills": "Thieving / Runecrafting / Astrology",
				"detail": "Recover the story of the abandoned cloister."
			},
			{
				"phase": "exploration",
				"title": "Sound the submerged passages",
				"status": "Passage discovery",
				"skills": "Fishing / Astrology / Agility",
				"detail": "Find the routes towards Tideworn Crypts and Mossbound Reliquary."
			},
			{
				"phase": "departure",
				"title": "Secure the chosen crossing",
				"status": "Chosen passage",
				"skills": "Crafting / Smithing / Fletching",
				"detail": "Finish the crossing for the selected route."
			}
		],
		"exits": [
			{
				"id": "tideworn_crypts",
				"label": "Tideworn Crypts",
				"supported": true
			},
			{
				"id": "mossbound_reliquary",
				"label": "Mossbound Reliquary",
				"supported": true
			}
		]
	},
	{
		"id": "rootforge_passage",
		"label": "Rootforge Passage",
		"depth": 1,
		"art": "https://cdn.melvor.azcn.io/assets/8fab892856db874b/rootforge-passage.png",
		"status": "New art concept",
		"existing": false,
		"tagline": "The forest swallowed the forge",
		"description": "Petrified roots bridge a vast abandoned furnace hall. A broken causeway threads between dormant furnaces, with only residual orange heat below.",
		"effects": "Proposed: sparse embers near furnace mouths and a slow residual glow. Keep flame movement restrained so the causeway remains readable.",
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Rootforge Passage",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Charting task."
			},
			{
				"phase": "arrival",
				"title": "Scout Rootforge Passage",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Scouting task."
			},
			{
				"phase": "arrival",
				"title": "Inspect the rootbound forge",
				"status": "Required",
				"skills": "Mining / Smithing / Firemaking",
				"detail": "Identify stable stonework and dangerous residual heat."
			},
			{
				"phase": "exploration",
				"title": "Clear the root-choked causeway",
				"status": "Required",
				"skills": "Woodcutting / Firemaking / Combat",
				"detail": "Open the main route without reigniting the whole forge."
			},
			{
				"phase": "exploration",
				"title": "Study the buried furnaces",
				"status": "Optional",
				"skills": "Smithing / Runecrafting / Firemaking",
				"detail": "Read the remains of the old forge craft."
			},
			{
				"phase": "exploration",
				"title": "Trace the roots into the terraces",
				"status": "Passage discovery",
				"skills": "Woodcutting / Astrology / Herblore",
				"detail": "Reveal the passage to Glassroot Terraces."
			},
			{
				"phase": "departure",
				"title": "Brace the causeway",
				"status": "Chosen passage",
				"skills": "Crafting / Smithing / Fletching",
				"detail": "Stabilize the last span before the Guild moves on."
			}
		],
		"exits": [
			{
				"id": "glassroot_terraces",
				"label": "Glassroot Terraces",
				"supported": true
			}
		]
	},
	{
		"id": "glassroot_terraces",
		"label": "Glassroot Terraces",
		"depth": 2,
		"art": "https://cdn.melvor.azcn.io/assets/c923426bf326724d/glassroot-terraces.png",
		"status": "Re-art concept",
		"existing": true,
		"tagline": "Where roots turn to glass",
		"description": "Pale monumental roots envelop worn stone terraces and mint crystal clusters above a turquoise abyss. Original layout, richer architectural rendering.",
		"effects": "Reuse the existing haze and crystal-glint renderer. Most clusters remain in similar locations, but check all eleven crystal silhouettes before integrating; the lower clusters have shifted.",
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Glassroot Terraces",
				"status": "Required",
				"skills": "Woodcutting / Runecrafting / Herblore",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Scout Glassroot Terraces",
				"status": "Required",
				"skills": "Woodcutting / Runecrafting / Herblore",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Clear the path",
				"status": "Required",
				"skills": "Woodcutting / Mining / Combat",
				"detail": "Existing authored task · 12 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Explore the chamber",
				"status": "Optional",
				"skills": "Firemaking / Herblore / Combat",
				"detail": "Existing authored task · 16 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Reveal the first passage",
				"status": "Optional",
				"skills": "Woodcutting / Runecrafting / Alt. Magic",
				"detail": "Existing authored task · 2 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the first passage",
				"status": "Conditional",
				"skills": "Mining / Agility / Summoning",
				"detail": "Existing authored task · 9 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Reveal the second passage",
				"status": "Optional",
				"skills": "Woodcutting / Firemaking / Herblore",
				"detail": "Existing authored task · 4 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the second passage",
				"status": "Conditional",
				"skills": "Agility / Astrology / Alt. Magic",
				"detail": "Existing authored task · 4 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Reveal the third passage",
				"status": "Optional",
				"skills": "Firemaking / Runecrafting / Herblore",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the third passage",
				"status": "Conditional",
				"skills": "Firemaking / Herblore / Alt. Magic",
				"detail": "Existing authored task · 4 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Study root crystal formations",
				"status": "Optional",
				"skills": "Cooking / Herblore / Harvesting",
				"detail": "Existing authored task · 20 baseline hours"
			}
		],
		"exits": [
			{
				"id": "convergence_gallery",
				"label": "Convergence Gallery",
				"supported": false
			},
			{
				"id": "spore_cathedral",
				"label": "Spore Cathedral",
				"supported": false
			},
			{
				"id": "buried_observatory",
				"label": "Buried Observatory",
				"supported": true
			}
		],
		"originalArt": "https://cdn.melvor.azcn.io/assets/ce8bf21419f2c534/glassroot-terraces.png"
	},
	{
		"id": "tideworn_crypts",
		"label": "Tideworn Crypts",
		"depth": 2,
		"art": "https://cdn.melvor.azcn.io/assets/c0eee6abb9e1d584/tideworn-crypts.png",
		"status": "New art concept",
		"existing": false,
		"tagline": "The water remembers",
		"description": "Tiered burial galleries overlook a receding tidal channel. Exposed tide marks and pale sealed sarcophagi reveal the scale of an ancient flood.",
		"effects": "Proposed: subtle channel reflections and low blue mist. No undead figures or moving tombs.",
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Tideworn Crypts",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Charting task."
			},
			{
				"phase": "arrival",
				"title": "Scout Tideworn Crypts",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Scouting task."
			},
			{
				"phase": "arrival",
				"title": "Mark the old waterlines",
				"status": "Required",
				"skills": "Fishing / Astrology / Agility",
				"detail": "Establish which burial tiers remain above the water."
			},
			{
				"phase": "exploration",
				"title": "Restore the upper walkways",
				"status": "Required",
				"skills": "Crafting / Smithing / Fletching",
				"detail": "Make a continuous route across the crypt galleries."
			},
			{
				"phase": "exploration",
				"title": "Read the burial inscriptions",
				"status": "Optional",
				"skills": "Runecrafting / Astrology / Thieving",
				"detail": "Study the sealed tombs without disturbing them."
			},
			{
				"phase": "exploration",
				"title": "Trace the high-water passage",
				"status": "Passage discovery",
				"skills": "Thieving / Mining / Combat",
				"detail": "Locate the onward route to Convergence Gallery."
			},
			{
				"phase": "departure",
				"title": "Secure the elevated route",
				"status": "Chosen passage",
				"skills": "Crafting / Smithing / Agility",
				"detail": "Strengthen the crossing above the tidal channel."
			}
		],
		"exits": [
			{
				"id": "convergence_gallery",
				"label": "Convergence Gallery",
				"supported": false
			}
		]
	},
	{
		"id": "embervein_machinery",
		"label": "Embervein Machinery",
		"depth": 2,
		"art": "https://cdn.melvor.azcn.io/assets/c6b7e8d18007a618/embervein-machinery.png",
		"status": "New art concept",
		"existing": false,
		"tagline": "A giant waiting to turn",
		"description": "A colossal flywheel and broken drive shafts span the chamber. Restrained furnace light separates dark iron silhouettes from distant machine halls.",
		"effects": "Proposed: localized heat haze and occasional vent sparks. A repaired lift could react to task progress later; the giant wheel stays still by default.",
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Embervein Machinery",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Charting task."
			},
			{
				"phase": "arrival",
				"title": "Scout Embervein Machinery",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Scouting task."
			},
			{
				"phase": "arrival",
				"title": "Inspect the broken drive",
				"status": "Required",
				"skills": "Smithing / Mining / Crafting",
				"detail": "Find the failed connections in the immense mechanism."
			},
			{
				"phase": "exploration",
				"title": "Repair the lift assembly",
				"status": "Required",
				"skills": "Smithing / Crafting / Fletching",
				"detail": "Restore a small practical part of the ancient machinery."
			},
			{
				"phase": "exploration",
				"title": "Study the furnace controls",
				"status": "Optional",
				"skills": "Firemaking / Runecrafting / Astrology",
				"detail": "Understand the remaining heat and its control system."
			},
			{
				"phase": "exploration",
				"title": "Trace the service shafts",
				"status": "Passage discovery",
				"skills": "Mining / Thieving / Agility",
				"detail": "Find routes towards Convergence Gallery and Ashen Foundry."
			},
			{
				"phase": "departure",
				"title": "Raise the passage lift",
				"status": "Chosen passage",
				"skills": "Smithing / Crafting / Agility",
				"detail": "Prepare the selected shaft for the Guild’s descent."
			}
		],
		"exits": [
			{
				"id": "convergence_gallery",
				"label": "Convergence Gallery",
				"supported": false
			},
			{
				"id": "ashen_foundry",
				"label": "Ashen Foundry",
				"supported": false
			}
		]
	},
	{
		"id": "mossbound_reliquary",
		"label": "Mossbound Reliquary",
		"depth": 2,
		"art": "https://cdn.melvor.azcn.io/assets/f96d0d38ea7f6c28/mossbound-reliquary.png",
		"status": "New art concept",
		"existing": false,
		"tagline": "Something was kept safe here",
		"description": "A sealed shrine rises above moss-covered steps and fallen slabs. Muted jade light and warm limestone make this the quietest, most sheltered room.",
		"effects": "Proposed: sparse dust in the light shafts and faint shrine glints. Avoid spores so it remains distinct from Spore Cathedral.",
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Mossbound Reliquary",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Charting task."
			},
			{
				"phase": "arrival",
				"title": "Scout Mossbound Reliquary",
				"status": "Required",
				"skills": "Summoning / Astrology / Cartography",
				"detail": "Retain the established Scouting task."
			},
			{
				"phase": "arrival",
				"title": "Survey the fallen sanctuary",
				"status": "Required",
				"skills": "Astrology / Summoning / Runecrafting",
				"detail": "Map the shrine and its unstable surrounding stonework."
			},
			{
				"phase": "exploration",
				"title": "Clear the shrine steps",
				"status": "Required",
				"skills": "Mining / Woodcutting / Agility",
				"detail": "Remove fallen stone and encroaching roots."
			},
			{
				"phase": "exploration",
				"title": "Decipher the shrine markings",
				"status": "Optional",
				"skills": "Runecrafting / Astrology / Thieving",
				"detail": "Piece together what the sanctuary once protected."
			},
			{
				"phase": "exploration",
				"title": "Uncover the concealed passages",
				"status": "Passage discovery",
				"skills": "Thieving / Woodcutting / Herblore",
				"detail": "Reveal routes towards Blackwater Nave and Spore Cathedral."
			},
			{
				"phase": "departure",
				"title": "Support the uncovered archway",
				"status": "Chosen passage",
				"skills": "Crafting / Smithing / Fletching",
				"detail": "Stabilize the selected way out of the sanctuary."
			}
		],
		"exits": [
			{
				"id": "blackwater_nave",
				"label": "Blackwater Nave",
				"supported": false
			},
			{
				"id": "spore_cathedral",
				"label": "Spore Cathedral",
				"supported": false
			}
		]
	},
	{
		"id": "buried_observatory",
		"label": "Buried Observatory",
		"depth": 3,
		"existing": true,
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Buried Observatory",
				"status": "Required",
				"skills": "Astrology / Combat / Archaeology",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Scout Buried Observatory",
				"status": "Required",
				"skills": "Astrology / Combat / Archaeology",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Study and align the monument",
				"status": "Required",
				"skills": "Crafting / Astrology / Cartography",
				"detail": "Existing authored task · 30 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Explore the chamber",
				"status": "Optional",
				"skills": "Agility / Alt. Magic / Archaeology",
				"detail": "Existing authored task · 10 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Reveal the passage",
				"status": "Optional",
				"skills": "Runecrafting / Summoning / Archaeology",
				"detail": "Existing authored task · 2 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Clear the passage",
				"status": "Conditional",
				"skills": "Alt. Magic / Archaeology / Harvesting",
				"detail": "Existing authored task · 2 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Clear the rubble",
				"status": "Optional",
				"skills": "Mining / Thieving / Archaeology",
				"detail": "Existing authored task · 30 baseline hours"
			}
		],
		"tagline": "The sky, buried in stone",
		"description": "A vast domed observatory, worn floor dial and broken brass crescent, lit by cold shafts through ancient windows.",
		"effects": "Preserve the dust-beam and gold-glint renderers. The crescent and beam silhouettes are similar; recheck the five beam triangles and facet anchors against the new image.",
		"exits": [
			{
				"id": "prismatic_orrery",
				"label": "Prismatic Orrery",
				"supported": true
			}
		],
		"originalArt": "https://cdn.melvor.azcn.io/assets/6ac2b271e33fe1e5/buried-observatory.png",
		"art": "https://cdn.melvor.azcn.io/assets/8206ace97350fd57/buried-observatory.png",
		"status": "Re-art concept"
	},
	{
		"id": "prismatic_orrery",
		"label": "Prismatic Orrery",
		"depth": 4,
		"existing": true,
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Prismatic Orrery",
				"status": "Required",
				"skills": "Runecrafting / Astrology / Cartography",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Scout Prismatic Orrery",
				"status": "Required",
				"skills": "Runecrafting / Astrology / Cartography",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Repair the mechanism",
				"status": "Required",
				"skills": "Smithing / Fletching / Crafting",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Explore the chamber",
				"status": "Optional",
				"skills": "Mining / Agility / Archaeology",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Locate the first passage",
				"status": "Optional",
				"skills": "Firemaking / Astrology / Cartography",
				"detail": "Existing authored task · 5 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Prepare the first passage",
				"status": "Conditional",
				"skills": "Firemaking / Mining / Combat",
				"detail": "Existing authored task · 3 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Locate the second passage",
				"status": "Optional",
				"skills": "Astrology / Alt. Magic / Cartography",
				"detail": "Existing authored task · 10 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Prepare the second passage",
				"status": "Conditional",
				"skills": "Woodcutting / Mining / Alt. Magic",
				"detail": "Existing authored task · 6 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Locate the third passage",
				"status": "Optional",
				"skills": "Runecrafting / Astrology / Cartography",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Prepare the third passage",
				"status": "Conditional",
				"skills": "Woodcutting / Firemaking / Combat",
				"detail": "Existing authored task · 12 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Secure the chamber",
				"status": "Optional",
				"skills": "Agility / Summoning / Combat",
				"detail": "Existing authored task · 20 baseline hours"
			}
		],
		"tagline": "An ancient model of impossible skies",
		"description": "A monumental armillary instrument surrounds a suspended cyan crystal, above a circular dais and deep vaulted galleries. The upright brass ring is visibly snapped across its lower arc, with a wide gap and jagged exposed ends.",
		"effects": "The existing free-orbit stars and neighbour links should remain reusable. Check orbit scale and brightness against the richer ring silhouette; no new occlusion mask is implied.",
		"exits": [
			{
				"id": "echoing_dais",
				"label": "Echoing Dais",
				"supported": false
			},
			{
				"id": "rootcrown_nexus",
				"label": "Rootcrown Nexus",
				"supported": false
			},
			{
				"id": "voidwatch_threshold",
				"label": "Voidwatch Threshold",
				"supported": true
			}
		],
		"originalArt": "https://cdn.melvor.azcn.io/assets/ce33c66d5590c305/prismatic-orrery.png",
		"art": "https://cdn.melvor.azcn.io/assets/38867ff6c375b720/prismatic-orrery.png",
		"status": "Re-art concept"
	},
	{
		"id": "voidwatch_threshold",
		"label": "Voidwatch Threshold",
		"depth": 5,
		"existing": true,
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart Voidwatch Threshold",
				"status": "Required",
				"skills": "Firemaking / Combat / Cartography",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Scout Voidwatch Threshold",
				"status": "Required",
				"skills": "Firemaking / Combat / Cartography",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Construct a bridge",
				"status": "Required",
				"skills": "Smithing / Fletching / Crafting",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Explore the chamber",
				"status": "Optional",
				"skills": "Agility / Combat / Archaeology",
				"detail": "Existing authored task · 10 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Discover the passage",
				"status": "Optional",
				"skills": "Thieving / Astrology / Cartography",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Prepare the passage",
				"status": "Conditional",
				"skills": "Mining / Crafting / Runecrafting",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Light braziers",
				"status": "Optional",
				"skills": "Firemaking / Fletching / Alt. Magic",
				"detail": "Existing authored task · 10 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Defend the passage",
				"status": "Optional",
				"skills": "Firemaking / Combat",
				"detail": "Existing authored task · 8 baseline hours"
			}
		],
		"tagline": "The last threshold before the dark",
		"description": "A narrow causeway crosses an abyss beneath receding monoliths, towards an immense sealed doorway.",
		"effects": "Reuse magical fire, rising embers, chasm mist and sill glow. Recheck the three pillar-top anchors, mist clipping and doorway sill after re-art.",
		"exits": [
			{
				"id": "hollow_star",
				"label": "The Hollow Star",
				"supported": true
			}
		],
		"originalArt": "https://cdn.melvor.azcn.io/assets/cd96e1632d583d6a/voidwatch-threshold.png",
		"art": "https://cdn.melvor.azcn.io/assets/9d78844284592984/voidwatch-threshold.png",
		"status": "Re-art concept"
	},
	{
		"id": "hollow_star",
		"label": "The Hollow Star",
		"depth": 6,
		"existing": true,
		"tasks": [
			{
				"phase": "arrival",
				"title": "Chart The Hollow Star",
				"status": "Required",
				"skills": "Firemaking / Astrology / Cartography",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Scout The Hollow Star",
				"status": "Required",
				"skills": "Firemaking / Astrology / Cartography",
				"detail": "Existing authored task · 8 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Light up the star",
				"status": "Required",
				"skills": "Firemaking / Summoning / Alt. Magic",
				"detail": "Existing authored task · 10 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Defend the star",
				"status": "Required",
				"skills": "Combat",
				"detail": "Existing authored task · 10 baseline hours"
			},
			{
				"phase": "departure",
				"title": "Complete The Hollow Star",
				"status": "Required",
				"skills": "Woodcutting / Firemaking / Mining / Agility / Astrology / Combat / Cartography",
				"detail": "Existing authored task · 6 baseline hours"
			},
			{
				"phase": "arrival",
				"title": "Vent the gases",
				"status": "Optional",
				"skills": "Agility / Summoning / Alt. Magic",
				"detail": "Existing authored task · 20 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Melt the star",
				"status": "Required",
				"skills": "Firemaking / Summoning / Alt. Magic",
				"detail": "Existing authored task · 16 baseline hours"
			},
			{
				"phase": "exploration",
				"title": "Defend the star",
				"status": "Required",
				"skills": "Combat",
				"detail": "Existing authored task · 16 baseline hours"
			}
		],
		"tagline": "A star waiting to wake",
		"description": "An unlit six-spoked metal star hangs above a deep circular pit in a dark underground chamber. Faint cool ambient light keeps the worn stone walkways readable; the player-driven ignition and plasma effects will provide the dominant light.",
		"effects": "Dark base artwork leaves the star dormant and removes external light shafts. Retain task-driven gas, ignition, plasma, motes and defense tendrils; verify star center/scale, reflected light and pit-rim clipping during integration. No overlay alignment has been verified in this static preview.",
		"exits": [],
		"originalArt": "https://cdn.melvor.azcn.io/assets/87ed83a66fbe98d7/hollow-star.png",
		"art": "https://cdn.melvor.azcn.io/assets/7409b401b03c3e4a/hollow-star.png",
		"status": "Re-art concept"
	}
];
const $=id=>document.getElementById(id);let selected='hollow_star';let showOriginal=false;
const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el};
function pick(id){if(!chambers.some(c=>c.id===id))return;selected=id;showOriginal=false;render();}
function roomButton(c,card=false){const b=make('button',card?'map-card':'room');b.type='button';b.dataset.room=c.id;b.setAttribute('aria-pressed',String(c.id===selected));const img=make('img');img.src=c.art;img.alt='';b.append(img);const s=make(card?'div':'span','',c.label);s.append(make(card?'p':'small','',card?'→ '+c.exits.map(e=>e.label).join(' / '):c.status));b.append(s);b.onclick=()=>pick(c.id);return b;}
function render(){const c=chambers.find(c=>c.id===selected);$('art').src=showOriginal&&c.originalArt?c.originalArt:c.art;$('compare').hidden=!c.originalArt;$('compare').textContent=showOriginal?'Show new artwork':'Show original artwork';$('compare').setAttribute('aria-pressed',String(showOriginal));$('art').alt=c.label+' artwork: '+c.description;$('name').textContent=c.label;$('status').textContent=showOriginal?'Original artwork':c.status;$('depth').textContent=c.depth?'Depth '+c.depth+' below The Rift':'Journey entrance';$('tagline').textContent=c.tagline;$('desc').textContent=c.description;$('effects').textContent=c.effects;
$('task-label').textContent=c.existing?'Existing authored tasks':'Proposed task design';$('task-note').textContent=c.existing?'Read from the current chamber catalog. This is repository content, not live Guild progress.':'Charting and Scouting retain their established role. Other titles and skill pairings are proposals; work targets, per-exit dependencies and balance remain to be finalized. Every required route retains a base-game activity option. No item donations or new combat system are implied.';
$('tasks').replaceChildren();for(const phase of ['arrival','exploration','departure']){const section=make('section','phase');section.append(make('h3','',phase[0].toUpperCase()+phase.slice(1)));for(const t of c.tasks.filter(t=>t.phase===phase)){const row=make('article','task');row.append(make('h4','',t.title),make('span','badge',t.status),make('p','skills',t.skills),make('p','',t.detail));section.append(row)}$('tasks').append(section)}
$('passages').replaceChildren();if(!c.exits.length)$('passages').append(make('p','muted','Ending chamber · no onward passages.'));for(const e of c.exits){const b=make('button','btn',e.label+(e.supported?' →':' · Outside this pass'));b.type='button';b.disabled=!e.supported;b.onclick=()=>pick(e.id);$('passages').append(b)}
$('rooms').replaceChildren();$('map-content').replaceChildren();for(const depth of [...new Set(chambers.map(c=>c.depth))]){const label=depth?'Depth '+depth:'The Rift';$('rooms').append(make('h2','',label));const list=make('div','room-list');const group=make('section','map-level');group.append(make('h3','',label));const grid=make('div','map-grid');for(const room of chambers.filter(x=>x.depth===depth)){list.append(roomButton(room));grid.append(roomButton(room,true))}$('rooms').append(list);group.append(grid);$('map-content').append(group)}const i=chambers.indexOf(c);$('previous').disabled=i===0;$('next').disabled=i===chambers.length-1;$('announcement').textContent='Selected '+c.label;}
$('compare').onclick=()=>{showOriginal=!showOriginal;render()};
$('previous').onclick=()=>pick(chambers[chambers.findIndex(c=>c.id===selected)-1]?.id);$('next').onclick=()=>pick(chambers[chambers.findIndex(c=>c.id===selected)+1]?.id);
$('full').onclick=async()=>{if(document.fullscreenEnabled){try{await $('hero').requestFullscreen();return}catch{}}window.open($('art').src,'_blank','noopener,noreferrer')};
for(const id of ['design','map']){$('tab-'+id).onclick=()=>{for(const key of ['design','map']){$(key).hidden=key!==id;$('tab-'+key).setAttribute('aria-selected',String(key===id))}};$('tab-'+id).onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const other=id==='design'?'map':'design';$('tab-'+other).click();$('tab-'+other).focus()}}}
render();
