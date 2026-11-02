// Session-scoped, memory-only: never carries player state or definitions between server instances.
export function create_equipment_catalog_cache(scope) {
	let owner = null, cached = null;
	return {
		prepare(endpoint) {
			const current = scope();
			if (owner !== current) { owner = current; cached = null; }
			if (!/^\/api\/(?:combat\/inventory|expedition\/(?:state|personal|task\/(?:start|check-in|stop)))(?:\?|$)/.test(endpoint))
				return { endpoint, hydrate: value => value };
			const known = cached;
			return {
				endpoint: endpoint + (endpoint.includes('?') ? '&' : '?') + 'equipment_catalog=' + (known?.catalog_revision ?? 'full'),
				hydrate(value) {
					if (scope() !== current) return null;
					const model = value?.equipment_projects;
					if (!model || typeof model.catalog_revision !== 'string') return value; // Older server.
					if (Array.isArray(model.catalog) && Array.isArray(model.access)) {
						cached = { catalog_revision: model.catalog_revision, catalog: model.catalog, access: model.access };
						return value;
					}
					// Bind hydration to the exact definitions advertised by this request, even across concurrent reads.
					if (!known || known.catalog_revision !== model.catalog_revision) throw new Error('Unknown equipment catalog revision');
					return { ...value, equipment_projects: { ...model, catalog: known.catalog, access: known.access } };
				}
			};
		}
	};
}
