# Repository tools

## Expedition graph viewer

Open [expedition-viewer.html](expedition-viewer.html) in a browser. The HTML contains all its styles and scripts;
there is no build step, package installation, backend, or external library. Copying just this file is sufficient.

- **From disk:** choose `server/expedition-content-v1.json` with the file picker. Local content stays in the browser.
- **From a URL:** paste an HTTP(S) JSON URL and select **Load URL**. GitHub `/blob/` file links are converted to
  `raw.githubusercontent.com` URLs. Other hosts must permit cross-origin browser requests (CORS). If a URL is blocked
  or needs authentication, download the JSON yourself and use the file picker.
- **Inspect:** chambers are arranged top to bottom by `depth`, preserving file order within each layer. Arrows follow
  exits. Green nodes are starts; amber nodes are endings. Select a node to highlight its immediate connections and
  inspect incoming chambers, exits, tasks, and original chamber JSON. Select an exit or incoming chamber in the detail
  panel to navigate to it. Nodes support Enter and Space activation.
- **Navigate:** scroll the graph, use zoom buttons, **Fit**, or **100%**. Search by chamber name or ID, then choose a
  result to bring it into view. **Clear selection** restores all connections. **Save SVG** downloads the current
  graph, including its selection and search highlights, at full size.

The primary format is `{ "chambers": [...] }`, with each chamber containing a unique string `id`, a non-empty
`label`, a non-negative integer `depth`, and `exits: [{ "target": "chamber_id" }]`. Optional `type`, `theme`, exit
`slot`, and `tasks` fields supply additional details. The earlier `{ "nodes": [{ "data": {...} }], "edges":
[{ "data": { "source": "id", "target": "id" } }] }` graph format also works; unwrapped nodes and edges are accepted.

The viewer checks duplicate IDs, missing targets, invalid depths, and exits that do not advance to a deeper layer.
It accepts at most 2,000 chambers and 10,000 exits. It is a graph inspection tool, not a full gameplay-content
validator or editor. Failed loads preserve the previous graph. URL requests omit browser credentials and time out
30 seconds after loading starts. Nothing is saved automatically.

Run the focused behavior checks from the repository root:

```sh
node --test tests/operations/expedition-viewer.test.mjs
```

## English cheat catalog editor

Open [cheat-catalog-editor.html](cheat-catalog-editor.html) in a browser. This standalone editor includes a baked-in
English snapshot of `server/cheat-mod-catalog.json` and the six category titles in
`mod/data/lang/en.json`; it needs no server, dependencies, or build step.

Edit category assignments, category titles, and the public description for each mod/category
assignment. Descriptions are optional: a blank or whitespace-only mod description leaves the assigned mod visible
without a description paragraph. Modal preview includes proposed assignments and labels unpublished mappings.
Search, category filtering, and the changes view help review the draft.

Edits save in browser storage when available. Use **Export for review** to keep a portable JSON copy containing the
original snapshot, edited values, changes and policy-review flags. Attach it in the maintainer chat for review and
application, followed by localization. **Import draft** resumes exports from the same snapshot; it rejects mismatched
snapshots and keeps source identity and review metadata. Assignment edits do not automatically approve unpublished
classifications. Changes to the current Item Cheats set are flagged for policy review because they affect Interdict enforcement.
General category descriptions are omitted; only per-mod explanations are editable.

Run focused editor checks with `node --test tests/operations/cheat-catalog-editor.test.mjs`.
