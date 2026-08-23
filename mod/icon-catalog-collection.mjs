const CONTENT_HASH = /^[0-9a-f]{64}$/;
const NAMESPACED_ID = /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;
const MEDIA_TYPES = new Set([
	'image/svg+xml',
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp'
]);

export const ICON_CATALOG_UPLOAD_CONCURRENCY = 3;

function report_diagnostic(on_diagnostic, skill_id, stage) {
	try {
		on_diagnostic({ skill_id: skill_id ?? null, stage });
	} catch (e) {
		// Collection diagnostics must never interfere with status synchronization.
	}
}

function candidate_key(candidate) {
	return `${candidate.skill_id}\u0000${candidate.content_hash}`;
}

function is_valid_candidate(candidate) {
	return candidate?.kind === 'skill' && typeof candidate.skill_id === 'string' &&
		NAMESPACED_ID.test(candidate.skill_id) && typeof candidate.content_hash === 'string' &&
		CONTENT_HASH.test(candidate.content_hash) && candidate.bytes instanceof Uint8Array &&
		Number.isSafeInteger(candidate.byte_length) && candidate.byte_length === candidate.bytes.byteLength &&
		candidate.byte_length > 0 &&
		MEDIA_TYPES.has(candidate.media_type);
}

function is_valid_check_response(response) {
	return response?.success === true &&
		(response.enabled === false || (response.enabled === true && Array.isArray(response.results)));
}

function is_matching_result(result, candidate) {
	return candidate !== undefined && result?.kind === 'skill' && result.skill_id === candidate.skill_id &&
		result.content_hash === candidate.content_hash && result.byte_length === candidate.byte_length &&
		result.media_type === candidate.media_type;
}

function is_successful_upload(response) {
	if (response === true)
		return true;
	if (response?.success === true)
		return true;
	return response?.response?.status === 200 && response?.json?.success === true;
}

export async function collect_skill_icon_candidates(skill_snapshot, {
	discover_candidates,
	check_manifest,
	upload_candidate,
	is_collection_allowed = () => true,
	maximum_upload_concurrency = ICON_CATALOG_UPLOAD_CONCURRENCY,
	on_diagnostic = () => {}
} = {}) {
	if (typeof discover_candidates !== 'function' || typeof check_manifest !== 'function' ||
		typeof upload_candidate !== 'function' || !Number.isSafeInteger(maximum_upload_concurrency) ||
		maximum_upload_concurrency < 1)
		return { status: 'invalid' };

	if (!is_collection_allowed())
		return { status: 'cancelled' };

	let discovered;
	try {
		discovered = await discover_candidates(skill_snapshot);
	} catch (e) {
		report_diagnostic(on_diagnostic, null, 'discovery');
		return { status: 'failed', stage: 'discovery' };
	}

	if (!Array.isArray(discovered)) {
		report_diagnostic(on_diagnostic, null, 'discovery');
		return { status: 'failed', stage: 'discovery' };
	}

	const candidates = [];
	const candidates_by_key = new Map();
	for (const candidate of discovered) {
		if (!is_valid_candidate(candidate)) {
			report_diagnostic(on_diagnostic, candidate?.skill_id, 'candidate');
			continue;
		}
		const key = candidate_key(candidate);
		if (candidates_by_key.has(key))
			continue;
		candidates_by_key.set(key, candidate);
		candidates.push(candidate);
	}

	if (candidates.length === 0)
		return { status: 'empty', candidate_count: 0, upload_count: 0, failure_count: 0 };

	if (!is_collection_allowed())
		return { status: 'cancelled' };

	const manifest = candidates.map(({ bytes, ...metadata }) => metadata);
	let checked;
	try {
		checked = await check_manifest(manifest);
	} catch (e) {
		report_diagnostic(on_diagnostic, null, 'check');
		return { status: 'failed', stage: 'check', candidate_count: candidates.length };
	}

	if (!is_valid_check_response(checked)) {
		report_diagnostic(on_diagnostic, null, 'check');
		return { status: 'failed', stage: 'check', candidate_count: candidates.length };
	}
	if (checked.enabled === false)
		return { status: 'disabled', candidate_count: candidates.length, upload_count: 0, failure_count: 0 };

	const requested_uploads = [];
	const seen_results = new Set();
	for (const result of checked.results) {
		if (typeof result?.skill_id !== 'string' || typeof result.content_hash !== 'string')
			continue;
		const candidate = candidates_by_key.get(candidate_key(result));
		if (!is_matching_result(result, candidate))
			continue;
		const key = candidate_key(result);
		if (seen_results.has(key))
			continue;
		seen_results.add(key);
		if (result.disposition === 'reuse')
			continue;
		if (result.disposition !== 'upload' || typeof result.upload_token !== 'string' || result.upload_token.length === 0)
			continue;
		requested_uploads.push({ candidate, result });
	}

	let next_upload = 0;
	let failure_count = 0;
	const upload_one = async () => {
		while (true) {
			const index = next_upload++;
			if (index >= requested_uploads.length)
				return;
			const request = requested_uploads[index];
			if (!is_collection_allowed())
				continue;
			try {
				const response = await upload_candidate(request.candidate, request.result);
				if (!is_successful_upload(response)) {
					failure_count++;
					report_diagnostic(on_diagnostic, request.candidate.skill_id, 'upload');
				}
			} catch (e) {
				failure_count++;
				report_diagnostic(on_diagnostic, request.candidate.skill_id, 'upload');
			}
		}
	};

	const worker_count = Math.min(maximum_upload_concurrency, requested_uploads.length);
	await Promise.all(Array.from({ length: worker_count }, () => upload_one()));
	return {
		status: 'complete',
		candidate_count: candidates.length,
		upload_count: requested_uploads.length - failure_count,
		failure_count
	};
}
