// Hosted URLs are already resolved. Only bundled paths belong to the mod context.
export function create_asset_url_resolver(urls, get_resource_url) {
	return resource_path => (Object.hasOwn(urls, resource_path) ? urls[resource_path] : get_resource_url(resource_path));
}
