import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../../tools/cheat-catalog-editor.html', import.meta.url), 'utf8');
const baseline = html.match(/<script id="baseline" type="application\/json">([\s\S]*?)<\/script>/)[1];
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];

function editor() {
	class Element {
		constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; this.textContent = ''; this.classList = { toggle() {} }; }
		setAttribute(name, value) { this.attributes[name] = value; }
		append(...children) { this.children.push(...children); if (this.tag === 'select' && this.value === undefined && this.children[0]) this.value = this.children[0].attributes.value; }
		replaceChildren(...children) { this.children = children; }
		addEventListener(name, handler) { this.events[name] = handler; }
		click() {}
		remove() {}
	}
	const elements = new Map();
	const document = {
		getElementById(id) {
			if (!elements.has(id)) elements.set(id, new Element());
			return elements.get(id);
		},
		createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }),
		querySelectorAll: () => [], body: new Element()
	};
	document.getElementById('baseline').textContent = baseline;
	const saved = new Map(), confirmations = [], downloads = [];
	const context = vm.createContext({ document, Blob, Date, setTimeout: callback => callback(),
		URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
		localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
		confirm(message) { confirmations.push(message); return true; }, alert(message) { throw Error(message); }
	});
	vm.runInContext(script, context);
	return { run: code => vm.runInContext(code, context), elements, confirmations, downloads };
}

function text(element) {
	return element.textContent + (element.children ?? []).map(text).join('');
}

test('blank mod descriptions export and import without losing the assignment or prompting', async () => {
	const app = editor();
	app.run("draft.mods.find(m => m.id === 2429395).classifications.find(c => c.category_id === 'items').public_explanation = ''; save();");
	app.elements.get('export').onclick();
	assert.deepEqual(app.confirmations, []);
	const exported = JSON.parse(await app.downloads[0].text());
	assert.equal(exported.edited.mods.find(m => m.id === 2429395).classifications.find(c => c.category_id === 'items').public_explanation, '');
	assert.equal(exported.changes.length, 1);
	assert.equal(exported.changes[0].type, 'mod_description');
	assert.equal(exported.policy_review.length, 0);
	assert.equal(exported.original.mods.find(m => m.id === 2429395).classifications.find(c => c.category_id === 'items').public_explanation,
		'Lets you add any item to the bank.');
	const restored = JSON.parse(app.run('JSON.stringify(validate(exportData().edited))'));
	assert.deepEqual(restored, exported.edited);
});

test('preview shows the assigned mod without placeholder reasoning for empty or whitespace descriptions', () => {
	for (const description of ['', '  ']) {
		const app = editor();
		app.run(`draft.mods.find(m => m.id === 2404399).classifications[0].public_explanation = ${JSON.stringify(description)}; view = 'preview'; render();`);
		const preview = app.elements.get('main');
		assert.ok(text(preview).includes('Gotta Go Fast'));
		assert.ok(!text(preview).includes('[Description not written yet]'));
		const paragraphs = [];
		function visit(node) { if (node.tag === 'p' && node.children.length === 1 && node.children[0].textContent === description) paragraphs.push(node); for (const child of node.children ?? []) visit(child); }
		visit(preview);
		assert.equal(paragraphs.length, 0);
	}
});

test('imports reject stale snapshots and duplicate assignments and preserve review metadata', () => {
	const app = editor();
	assert.throws(() => app.run("{ const input = copy(draft); input.source.fingerprint = 'stale'; validate(input); }"), /source snapshot/);
	assert.throws(() => app.run('{ const input = copy(draft); input.mods[0].classifications.push(copy(input.mods[0].classifications[0])); validate(input); }'), /Invalid category assignment/);
	assert.equal(app.run("{ const input = copy(draft); const mod = input.mods.find(m => m.classifications.some(c => c.publication_state === 'pending')); const c = mod.classifications.find(c => c.publication_state === 'pending'); c.publication_state = 'approved'; validate(input).mods.find(m => m.id === mod.id).classifications.find(x => x.category_id === c.category_id).publication_state; }"), 'pending');
	assert.equal(app.run("mapping(2253095, 'time').publication_state"), 'pending');
});


test('applied snapshot matches the catalog and starts with no policy flags or category descriptions', () => {
	const catalog = JSON.parse(readFileSync(new URL('../../server/cheat-mod-catalog.json', import.meta.url)));
	const snapshot = JSON.parse(baseline);
	assert.deepEqual(snapshot.mods.map(m => ({id:m.id,classifications:m.classifications})),
		catalog.map(m => ({id:m.id,classifications:m.classifications})));
	assert.ok(snapshot.categories.every(c => c.description === ''));
	const app = editor();
	assert.equal(app.run('policyChanges().length'), 0);
	app.run("draft.mods.find(m => m.id === 6209430).classifications = []; save(); view = 'categories'; render();");
	assert.equal(app.run('policyChanges().length'), 1);
	assert.ok(!text(app.elements.get('main')).includes('Category description in modal'));
});
