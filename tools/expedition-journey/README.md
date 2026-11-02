# Expedition Journey studio

Run from the repository root with Node.js (no package install, Docker, game, or backend required):

```sh
node scripts/expedition-journey.mjs
```

Open [Journey studio](http://127.0.0.1:4175/). Override the port with `EXPEDITION_JOURNEY_PORT`.

The full authored v1 graph (31 Chambers) always fixes the layout. Supported v3 IDs determine availability. Unavailable Chambers and all unrevealed geometry render nothing in the player view, but retain their positions in layout. Both content sources are read-only. The mod’s Journey tab now uses the same renderer with authoritative run history and discovery flags.

The graph is vertical, fills its card width, and sets its height from its aspect ratio. There is no map scrolling, panning or zoom. Names are absent from the resting map. Hover, focus, click or tap a node to show its name below it, using the Expedition progress-detail popup appearance. The popup clamps inside the map at either edge and dismisses on outside press or Escape. Only visited Chambers disclose their real names. Revealed but unvisited destinations show a question mark with the generic name “Unknown Chamber.” Gold lines show travelled passages, with a bright ring on the current Chamber.

Visibility belongs to each passage. An edge appears only when its source has been visited and its own reveal task is complete (or the edge has already been travelled). Revealing a destination never reveals its other incoming or onward edges. Unavailable endpoints are always hidden. Hiding geometry does not resize the graph or reorder nodes.

Ordering is derived deterministically from full topology alone, independent of route, availability and spacing. The optimizer exhaustively tries permutations within each small depth, alternating depth sweeps and accepting strict reductions in straight-line edge crossings. This reduces the current authored graph from 56 to 15 crossings; it does not guarantee the global minimum. Results are cached per content object. Future depths with more than seven nodes use bounded pair swaps instead of factorial search.

Use **Test scenario** for arrival with no discoveries, one or several revealed passages, a shared destination with its other incoming edge hidden, or a deeper journey. **Reveal tasks** lists passages from visited Chambers by authoring name: toggle each task individually. Traversed passages remain revealed and unavailable targets cannot be revealed. **Enter revealed passage** to advance. Selecting a node only displays its name. **Jump to Chamber** is an authoring shortcut that resets discovery flags; **Step back** preserves them. **Start over** and **No journey** reset them.

**Everything known (full authored graph)** shows all 31 Chambers and every passage at full opacity, including unavailable content. Hover, focus or tap any Chamber for its real name. This authoring preview preserves the simulated route and discovery flags; turn it off to return to the player view.

**Show hidden layout (debug only)** exposes faint topology for checking stable positions; leave it off for the player view. Simulation controls deliberately use authoring names outside that view.

Tune depth spacing, branch spacing and circle radius. Gap sliders reach zero without circle overlap. Defaults approximate the selected compact layout: depth gap 45, branch gap 35, radius 17. The 390px preview scales the complete layout with natural height. **Download scenario** records route, revealed passage IDs and tuning as JSON (no import UI yet). Reload resets the simulation.

`graph.mjs` reexports the shared shipped renderer from `mod/expedition-journey-graph.mjs`. The mod adapter consumes snapshot-supported IDs, saved visits and individually discovered passage IDs; this studio retains independent simulation controls. It makes no requests to a multiplayer server and cannot mutate live Expedition state. Screens here do not establish native Melvor acceptance.

Validate topology, route highlighting and local serving:

```sh
node --test tests/operations/expedition-journey.test.mjs
```
