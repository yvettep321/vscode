/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference lib="webworker" />

const VERSION = 1;

const resourceCacheName = `vscode-resource-cache-${VERSION}`;

const rootPath = self.location.pathname.replace(/\/service-worker.js$/, '');

/**
 * Root path for resources
 */
const resourceRoot = rootPath + '/vscode-resource';

const resolveTimeout = 30000;

/**
 * @template T
 * @typedef {{
 *     resolve: (x: T) => void,
 *     promise: Promise<T>
 * }} RequestStoreEntry
 */

/**
 * Caches
 * @template T
 */
class RequestStore {
	constructor() {
		/** @type {Map<number, RequestStoreEntry<T>>} */
		this.map = new Map();

		this.requestPool = 0;
	}

	/**
	 * @param {number} requestId
	 * @return {Promise<T> | undefined}
	 */
	get(requestId) {
		const entry = this.map.get(requestId);
		return entry && entry.promise;
	}

	/**
	 * @returns {{ requestId: number, promise: Promise<T> }}
	 */
	create() {
		const requestId = ++this.requestPool;

		let resolve;
		const promise = new Promise(r => resolve = r);
		const entry = { resolve, promise };
		this.map.set(requestId, entry);

		const dispose = () => {
			clearTimeout(timeout);
			const existingEntry = this.map.get(requestId);
			if (existingEntry === entry) {
				return this.map.delete(requestId);
			}
		};
		const timeout = setTimeout(dispose, resolveTimeout);
		return { requestId, promise };
	}

	/**
	 * @param {number} requestId
	 * @param {T} result
	 * @return {boolean}
	 */
	resolve(requestId, result) {
		const entry = this.map.get(requestId);
		if (!entry) {
			return false;
		}
		entry.resolve(result);
		this.map.delete(requestId);
		return true;
	}
}

/**
 * Map of requested paths to responses.
 * @typedef {{ type: 'response', body: any, mime: string, etag: string | undefined, } | { type: 'not-modified', mime: string } | undefined} ResourceResponse
 * @type {RequestStore<ResourceResponse>}
 */
const resourceRequestStore = new RequestStore();

/**
 * Map of requested localhost origins to optional redirects.
 *
 * @type {RequestStore<string | undefined>}
 */
const localhostRequestStore = new RequestStore();

const notFound = () =>
	new Response('Not Found', { status: 404, });

self.addEventListener('message', async (event) => {
	switch (event.data.channel) {
		case 'version':
			{
				self.clients.get(event.source.id).then(client => {
					if (client) {
						client.postMessage({
							channel: 'version',
							version: VERSION
						});
					}
				});
				return;
			}
		case 'did-load-resource':
			{
				/** @type {ResourceResponse} */
				let response = undefined;

				const data = event.data.data;
				switch (data.status) {
					case 200:
						{
							response = { type: 'response', body: data.data, mime: data.mime, etag: data.etag };
							break;
						}
					case 304:
						{
							response = { type: 'not-modified', mime: data.mime };
							break;
						}
				}

				if (!resourceRequestStore.resolve(data.id, response)) {
					console.log('Could not resolve unknown resource', data.path);
				}
				return;
			}
		case 'did-load-localhost':
			{
				const webviewId = getWebviewIdForClient(event.source);
				const data = event.data.data;
				if (!localhostRequestStore.resolve(data.id, data.location)) {
					console.log('Could not resolve unknown localhost', data.origin);
				}
				return;
			}
	}

	console.log('Unknown message');
});

self.addEventListener('fetch', (event) => {
	const requestUrl = new URL(event.request.url);

	// See if it's a resource request
	if (requestUrl.origin === self.origin && requestUrl.pathname.startsWith(resourceRoot + '/')) {
		return event.respondWith(processResourceRequest(event, requestUrl));
	}

	// See if it's a localhost request
	if (requestUrl.origin !== self.origin && requestUrl.host.match(/^localhost:(\d+)$/)) {
		return event.respondWith(processLocalhostRequest(event, requestUrl));
	}
});

self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting()); // Activate worker immediately
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim()); // Become available to all pages
});

/**
 * @param {FetchEvent} event
 * @param {URL} requestUrl
 */
async function processResourceRequest(event, requestUrl) {
	const client = await self.clients.get(event.clientId);
	if (!client) {
		console.log('Could not find inner client for request');
		return notFound();
	}

	const webviewId = getWebviewIdForClient(client);
	const resourcePath = requestUrl.pathname.startsWith(resourceRoot + '/') ? requestUrl.pathname.slice(resourceRoot.length) : requestUrl.pathname;

	/**
	 * @param {ResourceResponse} entry
	 * @param {Response | undefined} cachedResponse
	 */
	async function resolveResourceEntry(entry, cachedResponse) {
		if (!entry) {
			return notFound();
		}

		if (entry.type === 'not-modified') {
			if (cachedResponse) {
				return cachedResponse.clone();
			} else {
				throw new Error('No cache found');
			}
		}

		const cacheHeaders = entry.etag ? {
			'ETag': entry.etag,
			'Cache-Control': 'no-cache'
		} : {};

		const response = new Response(entry.body, {
			status: 200,
			headers: {
				'Content-Type': entry.mime,
				...cacheHeaders
			}
		});

		if (entry.etag) {
			caches.open(resourceCacheName).then(cache => {
				return cache.put(event.request, response);
			});
		}
		return response.clone();
	}

	const parentClient = await getOuterIframeClient(webviewId);
	if (!parentClient) {
		console.log('Could not find parent client for request');
		return notFound();
	}

	const cache = await caches.open(resourceCacheName);
	const cached = await cache.match(event.request);

	const { requestId, promise } = resourceRequestStore.create();
	parentClient.postMessage({
		channel: 'load-resource',
		id: requestId,
		path: resourcePath,
		ifNoneMatch: cached?.headers.get('ETag'),
	});

	return promise.then(entry => resolveResourceEntry(entry, cached));
}

/**
 * @param {*} event
 * @param {URL} requestUrl
 */
async function processLocalhostRequest(event, requestUrl) {
	const client = await self.clients.get(event.clientId);
	if (!client) {
		// This is expected when requesting resources on other localhost ports
		// that are not spawned by vs code
		return undefined;
	}
	const webviewId = getWebviewIdForClient(client);
	const origin = requestUrl.origin;

	/**
	 * @param {string} redirectOrigin
	 */
	const resolveRedirect = (redirectOrigin) => {
		if (!redirectOrigin) {
			return fetch(event.request);
		}
		const location = event.request.url.replace(new RegExp(`^${requestUrl.origin}(/|$)`), `${redirectOrigin}$1`);
		return new Response(null, {
			status: 302,
			headers: {
				Location: location
			}
		});
	};

	const parentClient = await getOuterIframeClient(webviewId);
	if (!parentClient) {
		console.log('Could not find parent client for request');
		return notFound();
	}

	const { requestId, promise } = localhostRequestStore.create();
	parentClient.postMessage({
		channel: 'load-localhost',
		origin: origin,
		id: requestId,
	});

	return promise.then(resolveRedirect);
}

function getWebviewIdForClient(client) {
	const requesterClientUrl = new URL(client.url);
	return requesterClientUrl.search.match(/\bid=([a-z0-9-]+)/i)[1];
}

async function getOuterIframeClient(webviewId) {
	const allClients = await self.clients.matchAll({ includeUncontrolled: true });
	return allClients.find(client => {
		const clientUrl = new URL(client.url);
		return (clientUrl.pathname === `${rootPath}/` || clientUrl.pathname === `${rootPath}/index.html`) && clientUrl.search.match(new RegExp('\\bid=' + webviewId));
	});
}
