let content;
let revision;
let skills = [];
let preview_route = {};
let selected_id = null;
let dirty = false;

const $ = selector => document.querySelector(selector);
const phase_names = { arrival: 'Arrival', exploration: 'Exploration', departure: 'Departure' };
const kind_names = { chart: 'Chart', scout: 'Scout', work: 'Work', discovery: 'Exit discovery',
	exit_preparation: 'Exit preparation', completion: 'Completion' };
const work_role_names = { groundwork: 'Groundwork', exploration: 'Exploration',
	initial_defense: 'Initial defense', melt_star: 'Final work', continued_defense: 'Continued defense',
	light_braziers: 'Brazier lighting', passage_defense: 'Passage defense' };

function element(tag, class_name, text) {
	const node = document.createElement(tag);
	if (class_name) node.className = class_name;
	if (text !== undefined) node.textContent = text;
	return node;
}

function show_message(message, success = false) {
	const node = $('#message');
	node.textContent = message;
	node.classList.toggle('success', success);
	node.hidden = false;
	clearTimeout(show_message.timeout);
	show_message.timeout = setTimeout(() => { node.hidden = true; }, 7000);
}

function set_dirty() {
	dirty = true;
	$('#save').disabled = false;
	$('#save-status').textContent = 'Unsaved changes';
}

function current_chamber() {
	return content.chambers.find(chamber => chamber.id === selected_id);
}

function preview_chamber_ids() {
	const ids = new Set(Object.keys(preview_route));
	for (const [chamber_id, exit_id] of Object.entries(preview_route)) {
		const chamber = content.chambers.find(entry => entry.id === chamber_id);
		const selected_exit = chamber?.exits.find(exit => exit.id === exit_id);
		if (selected_exit) ids.add(selected_exit.target);
	}
	return ids;
}

function preview_task_status(chamber, task) {
	if (!preview_chamber_ids().has(chamber.id)) return 'Full Expedition only';
	const selected_exit = preview_route[chamber.id];
	if (selected_exit && (task.discovery_target && task.discovery_target !== selected_exit ||
		task.exit_id && task.exit_id !== selected_exit)) return 'Inactive in preview';
	return null;
}

function is_structural(task) {
	return task.kind !== 'work';
}

function can_remove(chamber, task) {
	if (is_structural(task)) return 'This task is part of the Chamber route contract.';
	const dependent = chamber.tasks.find(other => other.id !== task.id && other.depends_on.includes(task.id));
	return dependent ? `Used by ${dependent.title}. Change that task’s prerequisites first.` : null;
}

function render_chamber_list() {
	const query = $('#search').value.trim().toLowerCase();
	const list = $('#chamber-list');
	list.replaceChildren();
	for (const chamber of content.chambers) {
		if (query && !`${chamber.label} ${chamber.id}`.toLowerCase().includes(query)) continue;
		const button = element('button', 'chamber-link');
		button.type = 'button';
		button.classList.toggle('active', chamber.id === selected_id);
		button.setAttribute('aria-current', chamber.id === selected_id ? 'true' : 'false');
		button.append(element('strong', '', chamber.label), element('small', '',
			`Depth ${chamber.depth} · ${chamber.tasks.length} tasks${preview_chamber_ids().has(chamber.id) ? ' · preview' : ''}`));
		button.addEventListener('click', () => {
			selected_id = chamber.id;
			render_chamber_list();
			render_chamber();
		});
		list.append(button);
	}
	$('#chamber-count').textContent = `${content.chambers.length} chambers`;
	$('#preview-count').textContent = '7 on preview route';
}

function add_task(chamber, phase) {
	const base_id = { arrival: 'arrival_support', exploration: 'exploration_work',
		departure: 'departure_support' }[phase];
	let id = base_id;
	let number = 2;
	while (chamber.tasks.some(task => task.id === id)) id = `${base_id}_${number++}`;
	chamber.tasks.push({ id, title: 'New task', phase, kind: 'work',
		requirement: 'optional', depends_on: phase === 'arrival' ? [] : ['arrival'],
		baseline_hours: 1, evidence: { type: 'skill_time', skill_ids: ['melvorD:Woodcutting'] } });
	set_dirty();
	render_chamber_list();
	render_chamber();
}

function task_header(chamber, task) {
	const th = element('th', 'task-head');
	th.scope = 'col';
	const preview_status = preview_task_status(chamber, task);
	if (preview_status) th.classList.add('preview-inactive');
	const top = element('div', 'head-top');
	const role = task.kind === 'work' ? work_role_names[task.id] ??
		(task.id.startsWith('arrival_support') ? 'Arrival support' :
			task.id.startsWith('exploration_work') ? 'Exploration work' :
				task.id.startsWith('departure_support') ? 'Departure support' : kind_names.work) : kind_names[task.kind];
	top.append(element('span', 'kind', role));
	if (preview_status) top.append(element('span', 'task-status', preview_status));
	if (task.kind === 'work') {
		const remove = element('button', 'remove-button', 'Remove');
		remove.type = 'button';
		const reason = can_remove(chamber, task);
		remove.disabled = Boolean(reason);
		if (reason) remove.title = reason;
		remove.setAttribute('aria-label', `Remove ${task.title}`);
		remove.addEventListener('click', () => {
			chamber.tasks.splice(chamber.tasks.indexOf(task), 1);
			set_dirty();
			render_chamber_list();
			render_chamber();
		});
		top.append(remove);
	}
	th.append(top, element('div', 'task-id', task.id));
	const title_label = element('label', 'head-label', 'Task title');
	const title = element('input');
	title.type = 'text';
	title.value = task.title;
	title.maxLength = 120;
	title.setAttribute('aria-label', `Title for ${task.id}`);
	title.addEventListener('input', () => { task.title = title.value; set_dirty(); });
	title_label.append(title);
	th.append(title_label);
	const meta = element('div', 'task-meta');
	const hours_label = element('label', 'head-label hours', 'Hours');
	const hours = element('input');
	hours.type = 'number';
	hours.min = '1';
	hours.max = '200';
	hours.step = '1';
	hours.value = task.baseline_hours;
	hours.setAttribute('aria-label', `Two-player baseline hours for ${task.id}`);
	hours.addEventListener('input', () => { task.baseline_hours = Number(hours.value); set_dirty(); });
	hours_label.append(hours);
	meta.append(hours_label);
	if (task.kind === 'work') {
		const requirement_label = element('label', 'head-label requirement', 'Needed?');
		const requirement = element('select');
		for (const value of ['required', 'optional']) {
			const option = element('option', '', value === 'required' ? 'Required' : 'Optional');
			option.value = value;
			requirement.append(option);
		}
		requirement.value = task.requirement;
		requirement.setAttribute('aria-label', `Requirement for ${task.id}`);
		requirement.addEventListener('change', () => { task.requirement = requirement.value; set_dirty(); });
		requirement_label.append(requirement);
		meta.append(requirement_label);
	}
	th.append(meta);
	if (task.kind === 'work') {
		const phase_label = element('label', 'head-label', 'Phase');
		const phase = element('select');
		for (const [value, name] of Object.entries(phase_names)) {
			const option = element('option', '', name);
			option.value = value;
			phase.append(option);
		}
		phase.value = task.phase;
		phase.setAttribute('aria-label', `Phase for ${task.id}`);
		phase.addEventListener('change', () => { task.phase = phase.value; set_dirty(); render_chamber(); });
		phase_label.append(phase);
		th.append(phase_label);
	}
	if (task.kind !== 'chart' && task.kind !== 'scout') {
		const details = element('details', 'prereqs');
		const summary = element('summary', '', 'Prerequisites');
		const input = element('input');
		input.type = 'text';
		input.value = task.depends_on.join(', ');
		input.placeholder = 'arrival, task_id';
		input.setAttribute('aria-label', `Prerequisites for ${task.id}, comma separated IDs`);
		input.addEventListener('input', () => {
			task.depends_on = [...new Set(input.value.split(',').map(value => value.trim()).filter(Boolean))];
			set_dirty();
		});
		input.addEventListener('change', render_chamber);
		details.append(summary, input);
		th.append(details);
	}
	return th;
}

function render_phase(chamber, phase) {
	const tasks = chamber.tasks.filter(task => task.phase === phase);
	const section = element('section', 'phase');
	const heading = element('div', 'phase-title');
	const title = element('div');
	title.append(element('h2', '', phase_names[phase]), element('p', '',
		`${tasks.length} task${tasks.length === 1 ? '' : 's'} · baseline hours are combined player time`));
	const add = element('button', 'add-button', '+ Add task');
	add.type = 'button';
	add.setAttribute('aria-label', `Add ${phase_names[phase].toLowerCase()} task`);
	add.addEventListener('click', () => add_task(chamber, phase));
	heading.append(title, add);
	section.append(heading);
	if (tasks.length === 0) {
		section.append(element('div', 'empty-phase', 'No tasks in this phase yet.'));
		return section;
	}
	const wrap = element('div', 'table-wrap');
	const table = element('table', 'matrix');
	const thead = element('thead');
	const headers = element('tr');
	const corner = element('th', 'skill-head', 'Work type');
	corner.scope = 'col';
	headers.append(corner, ...tasks.map(task => task_header(chamber, task)));
	thead.append(headers);
	table.append(thead);
	const tbody = element('tbody');
	let group = '';
	for (const skill of skills) {
		if (skill.group !== group) {
			group = skill.group;
			const divider = element('tr', 'group-row');
			const label = element('th', '', group);
			label.scope = 'rowgroup';
			divider.append(label);
			for (const task of tasks) divider.append(element('td'));
			tbody.append(divider);
		}
		const row = element('tr', 'skill-row');
		const head = element('th');
		head.scope = 'row';
		head.title = skill.name;
		const image = element('img');
		image.src = skill.icon;
		image.alt = '';
		image.addEventListener('error', () => image.classList.add('broken'));
		head.append(image, element('span', 'fallback', skill.name.slice(0, 2).toUpperCase()),
			element('span', 'sr-only', skill.name));
		row.append(head);
		for (const task of tasks) {
			const cell = element('td');
			if (preview_task_status(chamber, task)) cell.classList.add('preview-inactive');
			const checkbox = element('input');
			checkbox.type = 'checkbox';
			checkbox.checked = task.evidence.skill_ids.includes(skill.id);
			checkbox.setAttribute('aria-label', `${skill.name} accepted for ${task.title}`);
			cell.classList.toggle('checked', checkbox.checked);
			checkbox.addEventListener('change', () => {
				const enabled = new Set(task.evidence.skill_ids);
				if (checkbox.checked) enabled.add(skill.id);
				else enabled.delete(skill.id);
				task.evidence.skill_ids = skills.filter(entry => enabled.has(entry.id)).map(entry => entry.id);
				cell.classList.toggle('checked', checkbox.checked);
				set_dirty();
			});
			cell.append(checkbox);
			row.append(cell);
		}
		tbody.append(row);
	}
	table.append(tbody);
	wrap.append(table);
	section.append(wrap);
	return section;
}

function render_chamber() {
	const chamber = current_chamber();
	const root = $('#editor');
	root.replaceChildren();
	if (!chamber) return;
	const heading = element('div', 'chamber-heading');
	const info = element('div');
	info.append(element('div', 'eyebrow', `Depth ${chamber.depth} · ${chamber.type}`),
		element('h1', '', chamber.label), element('p', 'chamber-subtitle', `${chamber.id} · ${chamber.theme}`));
	const preview = preview_chamber_ids().has(chamber.id);
	heading.append(info, element('span', `badge${preview ? ' preview' : ''}`,
		preview ? 'Preview route' : 'Full Expedition only'));
	root.append(heading);
	if (preview_route[chamber.id]) {
		const notice = element('div', 'notice');
		notice.append(element('strong', '', 'Preview rule. '), document.createTextNode(
			`Only ${preview_route[chamber.id]} can receive votes. Other exits remain visible in the poll, but cannot receive votes or work during the preview.`));
		root.append(notice);
	} else {
		root.append(element('div', 'notice', 'Changes here are saved to authored content. Existing live Expeditions keep their own content snapshot.'));
	}
	if (chamber.exits.length) {
		const exits = element('section', 'exit-overview');
		exits.append(element('h2', '', 'Exits'));
		const list = element('div', 'exit-list');
		for (const exit of chamber.exits) {
			const target = content.chambers.find(entry => entry.id === exit.target);
			const active = preview && preview_route[chamber.id] === exit.id;
			const card = element('div', `exit-card${active ? ' active' : ' inactive'}`);
			card.append(element('strong', '', `Exit ${exit.slot} → ${target?.label ?? exit.target}`),
				element('span', 'exit-status', active ? 'Preview route' :
					preview ? 'Poll display only · vote/work unavailable' : 'Full Expedition only'));
			list.append(card);
		}
		exits.append(list);
		root.append(exits);
	}
	for (const phase of Object.keys(phase_names)) root.append(render_phase(chamber, phase));
}

async function load_content(force = false) {
	if (dirty && !force && !confirm('Discard unsaved changes and reload the source file?')) return;
	const [content_response, skills_response] = await Promise.all([fetch('/api/content'), fetch('/api/skills')]);
	if (!content_response.ok || !skills_response.ok) throw new Error('Could not load the authored content.');
	const data = await content_response.json();
	content = data.content;
	revision = data.revision;
	preview_route = data.preview_route ?? {};
	skills = (await skills_response.json()).skills;
	selected_id = content.chambers.some(chamber => chamber.id === selected_id) ? selected_id : content.chambers[0]?.id;
	dirty = false;
	$('#save').disabled = true;
	$('#save-status').textContent = 'All changes saved';
	render_chamber_list();
	render_chamber();
}

async function save_content() {
	if (!dirty) return;
	const button = $('#save');
	button.disabled = true;
	$('#save-status').textContent = 'Saving…';
	try {
		const saved_content = JSON.stringify(content);
		const response = await fetch('/api/content', {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ revision, content: JSON.parse(saved_content) })
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? 'Save failed');
		revision = result.revision;
		dirty = JSON.stringify(content) !== saved_content;
		button.disabled = !dirty;
		$('#save-status').textContent = dirty ? 'Unsaved changes' : 'All changes saved';
		show_message(dirty ? 'Saved the earlier edits. Save again for changes made during the save.' :
			'Chamber data saved to server/expedition-content-v1.json.', true);
	} catch (error) {
		button.disabled = false;
		$('#save-status').textContent = 'Unsaved changes';
		show_message(error.message);
	}
}

$('#search').addEventListener('input', render_chamber_list);
$('#reload').addEventListener('click', () => load_content().catch(error => show_message(error.message)));
$('#save').addEventListener('click', save_content);
document.addEventListener('keydown', event => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
		event.preventDefault();
		save_content();
	}
});
window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });
load_content(true).catch(error => { $('#editor').textContent = error.message; $('#save-status').textContent = 'Load failed'; });
