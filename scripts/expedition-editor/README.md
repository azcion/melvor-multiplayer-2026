# Expedition Chamber editor

From the repository root, run:

```sh
node scripts/expedition-editor.mjs
```

Open `http://127.0.0.1:4173/` in a browser. Set `EXPEDITION_EDITOR_PORT` to use another local port. The tool requires Node.js 24 or newer and does not need the game, Docker, or a package install.

Choose a Chamber in the left sidebar. Each phase shows one column per task and one icon row per accepted work type. Check multiple skills in a task column to accept any of them. Edit titles and two-player baseline hours directly; Chart and Scout are separate columns. Use **Add task** to create an ordinary optional work task in that phase. An ordinary task can be removed once no other task depends on it. Route discovery, preparation, Chart, Scout, and ending-completion tasks remain structural and cannot be removed here. Expand **Prerequisites** to edit dependency IDs when needed.

New tasks receive phase-based IDs such as `arrival_support`, `exploration_work`, or `departure_support`, with a numeric suffix when needed. The preview Chambers also show role labels for groundwork, chamber exploration, and their specialized work.

The Exits panel marks the selected preview route and the exits that appear only for poll display. Task columns tied to those unavailable exits say **Inactive in preview** and use muted colors. Chambers outside the preview path mark their tasks **Full Expedition only**. These labels describe preview availability; the editor still lets you author their full-Expedition data.

**Save changes** validates the complete graph and writes `server/expedition-content-v1.json` atomically. The editor rejects an invalid dependency, a task with no accepted work, a required chain without a base-game skill, and changes to the Chamber graph. It also refuses to overwrite a source file changed outside the editor since the page loaded. Reload to pick up external changes. There is no autosave; use Git to review or revert edits. Existing live Expeditions retain their snapshotted content.

Skill icons are served by the official Melvor website. If it is unreachable, each icon falls back to a two-letter label.
