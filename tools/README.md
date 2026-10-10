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
