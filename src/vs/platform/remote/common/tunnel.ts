/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { isWindows, OperatingSystem } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IAddressProvider } from 'vs/platform/remote/common/remoteAgentConnection';

export const ITunnelService = createDecorator<ITunnelService>('tunnelService');

export interface RemoteTunnel {
	readonly tunnelRemotePort: number;
	readonly tunnelRemoteHost: string;
	readonly tunnelLocalPort?: number;
	readonly localAddress: string;
	readonly public: boolean;
	dispose(silent?: boolean): Promise<void>;
}

export interface TunnelOptions {
	remoteAddress: { port: number, host: string; };
	localAddressPort?: number;
	label?: string;
	public?: boolean;
}

export interface TunnelCreationOptions {
	elevationRequired?: boolean;
}

export interface TunnelProviderFeatures {
	elevation: boolean;
	public: boolean;
}

export interface ITunnelProvider {
	forwardPort(tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions): Promise<RemoteTunnel | undefined> | undefined;
}

export interface ITunnel {
	remoteAddress: { port: number, host: string };

	/**
	 * The complete local address(ex. localhost:1234)
	 */
	localAddress: string;

	public?: boolean;

	/**
	 * Implementers of Tunnel should fire onDidDispose when dispose is called.
	 */
	onDidDispose: Event<void>;

	dispose(): Promise<void> | void;
}

export interface ITunnelService {
	readonly _serviceBrand: undefined;

	readonly tunnels: Promise<readonly RemoteTunnel[]>;
	readonly canMakePublic: boolean;
	readonly onTunnelOpened: Event<RemoteTunnel>;
	readonly onTunnelClosed: Event<{ host: string, port: number; }>;
	readonly canElevate: boolean;

	canTunnel(uri: URI): boolean;
	openTunnel(addressProvider: IAddressProvider | undefined, remoteHost: string | undefined, remotePort: number, localPort?: number, elevateIfNeeded?: boolean, isPublic?: boolean): Promise<RemoteTunnel | undefined> | undefined;
	closeTunnel(remoteHost: string, remotePort: number): Promise<void>;
	setTunnelProvider(provider: ITunnelProvider | undefined, features: TunnelProviderFeatures): IDisposable;
}

export function extractLocalHostUriMetaDataForPortMapping(uri: URI): { address: string, port: number; } | undefined {
	if (uri.scheme !== 'http' && uri.scheme !== 'https') {
		return undefined;
	}
	const localhostMatch = /^(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)$/.exec(uri.authority);
	if (!localhostMatch) {
		return undefined;
	}
	return {
		address: localhostMatch[1],
		port: +localhostMatch[2],
	};
}

export const LOCALHOST_ADDRESSES = ['localhost', '127.0.0.1', '0:0:0:0:0:0:0:1', '::1'];
export function isLocalhost(host: string): boolean {
	return LOCALHOST_ADDRESSES.indexOf(host) >= 0;
}

export const ALL_INTERFACES_ADDRESSES = ['0.0.0.0', '0:0:0:0:0:0:0:0', '::'];
export function isAllInterfaces(host: string): boolean {
	return ALL_INTERFACES_ADDRESSES.indexOf(host) >= 0;
}

function getOtherLocalhost(host: string): string | undefined {
	return (host === 'localhost') ? '127.0.0.1' : ((host === '127.0.0.1') ? 'localhost' : undefined);
}

export function isPortPrivileged(port: number, os?: OperatingSystem): boolean {
	if (os) {
		return os !== OperatingSystem.Windows && (port < 1024);
	} else {
		return !isWindows && (port < 1024);
	}
}

export abstract class AbstractTunnelService implements ITunnelService {
	declare readonly _serviceBrand: undefined;

	private _onTunnelOpened: Emitter<RemoteTunnel> = new Emitter();
	public onTunnelOpened: Event<RemoteTunnel> = this._onTunnelOpened.event;
	private _onTunnelClosed: Emitter<{ host: string, port: number; }> = new Emitter();
	public onTunnelClosed: Event<{ host: string, port: number; }> = this._onTunnelClosed.event;
	protected readonly _tunnels = new Map</*host*/ string, Map</* port */ number, { refcount: number, readonly value: Promise<RemoteTunnel | undefined>; }>>();
	protected _tunnelProvider: ITunnelProvider | undefined;
	protected _canElevate: boolean = false;
	private _canMakePublic: boolean = false;

	public constructor(
		@ILogService protected readonly logService: ILogService
	) { }

	setTunnelProvider(provider: ITunnelProvider | undefined, features: TunnelProviderFeatures): IDisposable {
		this._tunnelProvider = provider;
		if (!provider) {
			// clear features
			this._canElevate = false;
			this._canMakePublic = false;
			return {
				dispose: () => { }
			};
		}
		this._canElevate = features.elevation;
		this._canMakePublic = features.public;
		return {
			dispose: () => {
				this._tunnelProvider = undefined;
				this._canElevate = false;
				this._canMakePublic = false;
			}
		};
	}

	public get canElevate(): boolean {
		return this._canElevate;
	}

	public get canMakePublic() {
		return this._canMakePublic;
	}

	public get tunnels(): Promise<readonly RemoteTunnel[]> {
		return new Promise(async (resolve) => {
			const tunnels: RemoteTunnel[] = [];
			const tunnelArray = Array.from(this._tunnels.values());
			for (let portMap of tunnelArray) {
				const portArray = Array.from(portMap.values());
				for (let x of portArray) {
					const tunnelValue = await x.value;
					if (tunnelValue) {
						tunnels.push(tunnelValue);
					}
				}
			}
			resolve(tunnels);
		});
	}

	async dispose(): Promise<void> {
		for (const portMap of this._tunnels.values()) {
			for (const { value } of portMap.values()) {
				await value.then(tunnel => tunnel?.dispose());
			}
			portMap.clear();
		}
		this._tunnels.clear();
	}

	openTunnel(addressProvider: IAddressProvider | undefined, remoteHost: string | undefined, remotePort: number, localPort?: number, elevateIfNeeded: boolean = false, isPublic: boolean = false): Promise<RemoteTunnel | undefined> | undefined {
		this.logService.trace(`openTunnel request for ${remoteHost}:${remotePort} on local port ${localPort}.`);
		if (!addressProvider) {
			return undefined;
		}

		if (!remoteHost) {
			remoteHost = 'localhost';
		}

		const resolvedTunnel = this.retainOrCreateTunnel(addressProvider, remoteHost, remotePort, localPort, elevateIfNeeded, isPublic);
		if (!resolvedTunnel) {
			this.logService.trace(`Tunnel was not created.`);
			return resolvedTunnel;
		}

		return resolvedTunnel.then(tunnel => {
			if (!tunnel) {
				this.logService.trace('New tunnel is undefined.');
				this.removeEmptyTunnelFromMap(remoteHost!, remotePort);
				return undefined;
			}
			this.logService.trace('New tunnel established.');
			const newTunnel = this.makeTunnel(tunnel);
			if (tunnel.tunnelRemoteHost !== remoteHost || tunnel.tunnelRemotePort !== remotePort) {
				this.logService.warn('Created tunnel does not match requirements of requested tunnel. Host or port mismatch.');
			}
			this._onTunnelOpened.fire(newTunnel);
			return newTunnel;
		});
	}

	private makeTunnel(tunnel: RemoteTunnel): RemoteTunnel {
		return {
			tunnelRemotePort: tunnel.tunnelRemotePort,
			tunnelRemoteHost: tunnel.tunnelRemoteHost,
			tunnelLocalPort: tunnel.tunnelLocalPort,
			localAddress: tunnel.localAddress,
			public: tunnel.public,
			dispose: async () => {
				const existingHost = this._tunnels.get(tunnel.tunnelRemoteHost);
				if (existingHost) {
					const existing = existingHost.get(tunnel.tunnelRemotePort);
					if (existing) {
						existing.refcount--;
						await this.tryDisposeTunnel(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort, existing);
					}
				}
			}
		};
	}

	private async tryDisposeTunnel(remoteHost: string, remotePort: number, tunnel: { refcount: number, readonly value: Promise<RemoteTunnel | undefined> }): Promise<void> {
		if (tunnel.refcount <= 0) {
			this.logService.trace(`Tunnel is being disposed ${remoteHost}:${remotePort}.`);
			const disposePromise: Promise<void> = tunnel.value.then(async (tunnel) => {
				if (tunnel) {
					await tunnel.dispose(true);
					this._onTunnelClosed.fire({ host: tunnel.tunnelRemoteHost, port: tunnel.tunnelRemotePort });
				}
			});
			if (this._tunnels.has(remoteHost)) {
				this._tunnels.get(remoteHost)!.delete(remotePort);
			}
			return disposePromise;
		}
	}

	async closeTunnel(remoteHost: string, remotePort: number): Promise<void> {
		const portMap = this._tunnels.get(remoteHost);
		if (portMap && portMap.has(remotePort)) {
			const value = portMap.get(remotePort)!;
			value.refcount = 0;
			await this.tryDisposeTunnel(remoteHost, remotePort, value);
		}
	}

	protected addTunnelToMap(remoteHost: string, remotePort: number, tunnel: Promise<RemoteTunnel | undefined>) {
		if (!this._tunnels.has(remoteHost)) {
			this._tunnels.set(remoteHost, new Map());
		}
		this._tunnels.get(remoteHost)!.set(remotePort, { refcount: 1, value: tunnel });
	}

	private async removeEmptyTunnelFromMap(remoteHost: string, remotePort: number) {
		const hostMap = this._tunnels.get(remoteHost);
		if (hostMap) {
			const tunnel = hostMap.get(remotePort);
			const tunnelResult = await tunnel;
			if (!tunnelResult) {
				hostMap.delete(remotePort);
			}
			if (hostMap.size === 0) {
				this._tunnels.delete(remoteHost);
			}
		}
	}

	protected getTunnelFromMap(remoteHost: string, remotePort: number): { refcount: number, readonly value: Promise<RemoteTunnel | undefined> } | undefined {
		const otherLocalhost = getOtherLocalhost(remoteHost);
		let portMap: Map<number, { refcount: number, readonly value: Promise<RemoteTunnel | undefined> }> | undefined;
		if (otherLocalhost) {
			const firstMap = this._tunnels.get(remoteHost);
			const secondMap = this._tunnels.get(otherLocalhost);
			if (firstMap && secondMap) {
				portMap = new Map([...Array.from(firstMap.entries()), ...Array.from(secondMap.entries())]);
			} else {
				portMap = firstMap ?? secondMap;
			}
		} else {
			portMap = this._tunnels.get(remoteHost);
		}
		return portMap ? portMap.get(remotePort) : undefined;
	}

	canTunnel(uri: URI): boolean {
		return !!extractLocalHostUriMetaDataForPortMapping(uri);
	}

	protected abstract retainOrCreateTunnel(addressProvider: IAddressProvider, remoteHost: string, remotePort: number, localPort: number | undefined, elevateIfNeeded: boolean, isPublic: boolean): Promise<RemoteTunnel | undefined> | undefined;

	protected createWithProvider(tunnelProvider: ITunnelProvider, remoteHost: string, remotePort: number, localPort: number | undefined, elevateIfNeeded: boolean, isPublic: boolean): Promise<RemoteTunnel | undefined> | undefined {
		this.logService.trace(`Creating tunnel with provider ${remoteHost}:${remotePort} on local port ${localPort}.`);

		const preferredLocalPort = localPort === undefined ? remotePort : localPort;
		const creationInfo = { elevationRequired: elevateIfNeeded ? isPortPrivileged(preferredLocalPort) : false };
		const tunnelOptions: TunnelOptions = { remoteAddress: { host: remoteHost, port: remotePort }, localAddressPort: localPort, public: isPublic };
		const tunnel = tunnelProvider.forwardPort(tunnelOptions, creationInfo);
		this.logService.trace('Tunnel created by provider.');
		if (tunnel) {
			this.addTunnelToMap(remoteHost, remotePort, tunnel);
		}
		return tunnel;
	}
}


