/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IShellLaunchConfig, ITerminalProcessExtHostProxy, ISpawnExtHostProcessRequest, ITerminalDimensions, IAvailableShellsRequest, IDefaultShellAndArgsRequest, IStartExtensionTerminalRequest, ITerminalConfiguration, TERMINAL_CONFIG_SECTION } from 'vs/workbench/contrib/terminal/common/terminal';
import { ExtHostContext, ExtHostTerminalServiceShape, MainThreadTerminalServiceShape, MainContext, IExtHostContext, IShellLaunchConfigDto, TerminalLaunchConfig, ITerminalDimensionsDto, TerminalIdentifier } from 'vs/workbench/api/common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { URI } from 'vs/base/common/uri';
import { StopWatch } from 'vs/base/common/stopwatch';
import { ITerminalInstanceService, ITerminalService, ITerminalInstance, ITerminalExternalLinkProvider, ITerminalLink } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TerminalDataBufferer } from 'vs/workbench/contrib/terminal/common/terminalDataBuffering';
import { IEnvironmentVariableService, ISerializableEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { deserializeEnvironmentVariableCollection, serializeEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableShared';
import { ILogService } from 'vs/platform/log/common/log';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

@extHostNamedCustomer(MainContext.MainThreadTerminalService)
export class MainThreadTerminalService implements MainThreadTerminalServiceShape {

	private _proxy: ExtHostTerminalServiceShape;
	/**
	 * Stores a map from a temporary terminal id (a UUID generated on the extension host side)
	 * to a numeric terminal id (an id generated on the renderer side)
	 * This comes in play only when dealing with terminals created on the extension host side
	 */
	private _extHostTerminalIds = new Map<string, number>();
	private _remoteAuthority: string | null;
	private readonly _toDispose = new DisposableStore();
	private readonly _terminalProcessProxies = new Map<number, ITerminalProcessExtHostProxy>();
	private _dataEventTracker: TerminalDataEventTracker | undefined;
	/**
	 * A single shared terminal link provider for the exthost. When an ext registers a link
	 * provider, this is registered with the terminal on the renderer side and all links are
	 * provided through this, even from multiple ext link providers. Xterm should remove lower
	 * priority intersecting links itself.
	 */
	private _linkProvider: IDisposable | undefined;

	constructor(
		extHostContext: IExtHostContext,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ITerminalInstanceService readonly terminalInstanceService: ITerminalInstanceService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEnvironmentVariableService private readonly _environmentVariableService: IEnvironmentVariableService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostTerminalService);
		this._remoteAuthority = extHostContext.remoteAuthority;

		// ITerminalService listeners
		this._toDispose.add(_terminalService.onInstanceCreated((instance) => {
			this._onTerminalOpened(instance);
			this._onInstanceDimensionsChanged(instance);
		}));

		this._toDispose.add(_terminalService.onInstanceDisposed(instance => this._onTerminalDisposed(instance)));
		this._toDispose.add(_terminalService.onInstanceProcessIdReady(instance => this._onTerminalProcessIdReady(instance)));
		this._toDispose.add(_terminalService.onInstanceDimensionsChanged(instance => this._onInstanceDimensionsChanged(instance)));
		this._toDispose.add(_terminalService.onInstanceMaximumDimensionsChanged(instance => this._onInstanceMaximumDimensionsChanged(instance)));
		this._toDispose.add(_terminalService.onInstanceRequestSpawnExtHostProcess(request => this._onRequestSpawnExtHostProcess(request)));
		this._toDispose.add(_terminalService.onInstanceRequestStartExtensionTerminal(e => this._onRequestStartExtensionTerminal(e)));
		this._toDispose.add(_terminalService.onActiveInstanceChanged(instance => this._onActiveTerminalChanged(instance ? instance.id : null)));
		this._toDispose.add(_terminalService.onInstanceTitleChanged(instance => instance && this._onTitleChanged(instance.id, instance.title)));
		this._toDispose.add(_terminalService.configHelper.onWorkspacePermissionsChanged(isAllowed => this._onWorkspacePermissionsChanged(isAllowed)));
		this._toDispose.add(_terminalService.onRequestAvailableShells(e => this._onRequestAvailableShells(e)));

		// ITerminalInstanceService listeners
		if (terminalInstanceService.onRequestDefaultShellAndArgs) {
			this._toDispose.add(terminalInstanceService.onRequestDefaultShellAndArgs(e => this._onRequestDefaultShellAndArgs(e)));
		}

		// Set initial ext host state
		this._terminalService.terminalInstances.forEach(t => {
			this._onTerminalOpened(t);
			t.processReady.then(() => this._onTerminalProcessIdReady(t));
		});
		const activeInstance = this._terminalService.getActiveInstance();
		if (activeInstance) {
			this._proxy.$acceptActiveTerminalChanged(activeInstance.id);
		}
		if (this._environmentVariableService.collections.size > 0) {
			const collectionAsArray = [...this._environmentVariableService.collections.entries()];
			const serializedCollections: [string, ISerializableEnvironmentVariableCollection][] = collectionAsArray.map(e => {
				return [e[0], serializeEnvironmentVariableCollection(e[1].map)];
			});
			this._proxy.$initEnvironmentVariableCollections(serializedCollections);
		}

		this._terminalService.extHostReady(extHostContext.remoteAuthority!); // TODO@Tyriar: remove null assertion
	}

	public dispose(): void {
		this._toDispose.dispose();
		this._linkProvider?.dispose();

		// TODO@Daniel: Should all the previously created terminals be disposed
		// when the extension host process goes down ?
	}

	private _getTerminalId(id: TerminalIdentifier): number | undefined {
		if (typeof id === 'number') {
			return id;
		}
		return this._extHostTerminalIds.get(id);
	}

	private _getTerminalInstance(id: TerminalIdentifier): ITerminalInstance | undefined {
		const rendererId = this._getTerminalId(id);
		if (typeof rendererId === 'number') {
			return this._terminalService.getInstanceFromId(rendererId);
		}
		return undefined;
	}

	public async $createTerminal(extHostTerminalId: string, launchConfig: TerminalLaunchConfig): Promise<void> {
		const shellLaunchConfig: IShellLaunchConfig = {
			name: launchConfig.name,
			executable: launchConfig.shellPath,
			args: launchConfig.shellArgs,
			cwd: typeof launchConfig.cwd === 'string' ? launchConfig.cwd : URI.revive(launchConfig.cwd),
			waitOnExit: launchConfig.waitOnExit,
			ignoreConfigurationCwd: true,
			env: launchConfig.env,
			strictEnv: launchConfig.strictEnv,
			hideFromUser: launchConfig.hideFromUser,
			isExtensionTerminal: launchConfig.isExtensionTerminal,
			extHostTerminalId: extHostTerminalId,
			isFeatureTerminal: launchConfig.isFeatureTerminal
		};
		const terminal = this._terminalService.createTerminal(shellLaunchConfig);
		this._extHostTerminalIds.set(extHostTerminalId, terminal.id);
	}

	public $show(id: TerminalIdentifier, preserveFocus: boolean): void {
		const terminalInstance = this._getTerminalInstance(id);
		if (terminalInstance) {
			this._terminalService.setActiveInstance(terminalInstance);
			this._terminalService.showPanel(!preserveFocus);
		}
	}

	public $hide(id: TerminalIdentifier): void {
		const rendererId = this._getTerminalId(id);
		const instance = this._terminalService.getActiveInstance();
		if (instance && instance.id === rendererId) {
			this._terminalService.hidePanel();
		}
	}

	public $dispose(id: TerminalIdentifier): void {
		const terminalInstance = this._getTerminalInstance(id);
		if (terminalInstance) {
			terminalInstance.dispose();
		}
	}

	public $sendText(id: TerminalIdentifier, text: string, addNewLine: boolean): void {
		const terminalInstance = this._getTerminalInstance(id);
		if (terminalInstance) {
			terminalInstance.sendText(text, addNewLine);
		}
	}

	public $startSendingDataEvents(): void {
		if (!this._dataEventTracker) {
			this._dataEventTracker = this._instantiationService.createInstance(TerminalDataEventTracker, (id, data) => {
				this._onTerminalData(id, data);
			});
			// Send initial events if they exist
			this._terminalService.terminalInstances.forEach(t => {
				t.initialDataEvents?.forEach(d => this._onTerminalData(t.id, d));
			});
		}
	}

	public $stopSendingDataEvents(): void {
		if (this._dataEventTracker) {
			this._dataEventTracker.dispose();
			this._dataEventTracker = undefined;
		}
	}

	public $startLinkProvider(): void {
		this._linkProvider?.dispose();
		this._linkProvider = this._terminalService.registerLinkProvider(new ExtensionTerminalLinkProvider(this._proxy));
	}

	public $stopLinkProvider(): void {
		this._linkProvider?.dispose();
		this._linkProvider = undefined;
	}

	public $registerProcessSupport(isSupported: boolean): void {
		this._terminalService.registerProcessSupport(isSupported);
	}

	private _onActiveTerminalChanged(terminalId: number | null): void {
		this._proxy.$acceptActiveTerminalChanged(terminalId);
	}

	private _onTerminalData(terminalId: number, data: string): void {
		this._proxy.$acceptTerminalProcessData(terminalId, data);
	}

	private _onTitleChanged(terminalId: number, name: string): void {
		this._proxy.$acceptTerminalTitleChange(terminalId, name);
	}

	private _onWorkspacePermissionsChanged(isAllowed: boolean): void {
		this._proxy.$acceptWorkspacePermissionsChanged(isAllowed);
	}

	private _onTerminalDisposed(terminalInstance: ITerminalInstance): void {
		this._proxy.$acceptTerminalClosed(terminalInstance.id, terminalInstance.exitCode);
	}

	private _onTerminalOpened(terminalInstance: ITerminalInstance): void {
		const extHostTerminalId = terminalInstance.shellLaunchConfig.extHostTerminalId;
		const shellLaunchConfigDto: IShellLaunchConfigDto = {
			name: terminalInstance.shellLaunchConfig.name,
			executable: terminalInstance.shellLaunchConfig.executable,
			args: terminalInstance.shellLaunchConfig.args,
			cwd: terminalInstance.shellLaunchConfig.cwd,
			env: terminalInstance.shellLaunchConfig.env,
			hideFromUser: terminalInstance.shellLaunchConfig.hideFromUser
		};
		this._proxy.$acceptTerminalOpened(terminalInstance.id, extHostTerminalId, terminalInstance.title, shellLaunchConfigDto);
	}

	private _onTerminalProcessIdReady(terminalInstance: ITerminalInstance): void {
		if (terminalInstance.processId === undefined) {
			return;
		}
		this._proxy.$acceptTerminalProcessId(terminalInstance.id, terminalInstance.processId);
	}

	private _onInstanceDimensionsChanged(instance: ITerminalInstance): void {
		this._proxy.$acceptTerminalDimensions(instance.id, instance.cols, instance.rows);
	}

	private _onInstanceMaximumDimensionsChanged(instance: ITerminalInstance): void {
		this._proxy.$acceptTerminalMaximumDimensions(instance.id, instance.maxCols, instance.maxRows);
	}

	private _onRequestSpawnExtHostProcess(request: ISpawnExtHostProcessRequest): void {
		// Only allow processes on remote ext hosts
		if (!this._remoteAuthority) {
			return;
		}

		const proxy = request.proxy;
		this._terminalProcessProxies.set(proxy.terminalId, proxy);
		const shellLaunchConfigDto: IShellLaunchConfigDto = {
			name: request.shellLaunchConfig.name,
			executable: request.shellLaunchConfig.executable,
			args: request.shellLaunchConfig.args,
			cwd: request.shellLaunchConfig.cwd,
			env: request.shellLaunchConfig.env,
			flowControl: this._configurationService.getValue<ITerminalConfiguration>(TERMINAL_CONFIG_SECTION).flowControl
		};

		this._logService.trace('Spawning ext host process', { terminalId: proxy.terminalId, shellLaunchConfigDto, request });
		this._proxy.$spawnExtHostProcess(
			proxy.terminalId,
			shellLaunchConfigDto,
			request.activeWorkspaceRootUri,
			request.cols,
			request.rows,
			request.isWorkspaceShellAllowed
		).then(request.callback, request.callback);

		proxy.onAcknowledgeDataEvent(charCount => this._proxy.$acceptProcessAckDataEvent(proxy.terminalId, charCount));
		proxy.onInput(data => this._proxy.$acceptProcessInput(proxy.terminalId, data));
		proxy.onResize(dimensions => this._proxy.$acceptProcessResize(proxy.terminalId, dimensions.cols, dimensions.rows));
		proxy.onShutdown(immediate => this._proxy.$acceptProcessShutdown(proxy.terminalId, immediate));
		proxy.onRequestCwd(() => this._proxy.$acceptProcessRequestCwd(proxy.terminalId));
		proxy.onRequestInitialCwd(() => this._proxy.$acceptProcessRequestInitialCwd(proxy.terminalId));
		proxy.onRequestLatency(() => this._onRequestLatency(proxy.terminalId));
	}

	private _onRequestStartExtensionTerminal(request: IStartExtensionTerminalRequest): void {
		const proxy = request.proxy;
		this._terminalProcessProxies.set(proxy.terminalId, proxy);

		// Note that onReisze is not being listened to here as it needs to fire when max dimensions
		// change, excluding the dimension override
		const initialDimensions: ITerminalDimensionsDto | undefined = request.cols && request.rows ? {
			columns: request.cols,
			rows: request.rows
		} : undefined;

		this._proxy.$startExtensionTerminal(
			proxy.terminalId,
			initialDimensions
		).then(request.callback);

		proxy.onInput(data => this._proxy.$acceptProcessInput(proxy.terminalId, data));
		proxy.onShutdown(immediate => this._proxy.$acceptProcessShutdown(proxy.terminalId, immediate));
		proxy.onRequestCwd(() => this._proxy.$acceptProcessRequestCwd(proxy.terminalId));
		proxy.onRequestInitialCwd(() => this._proxy.$acceptProcessRequestInitialCwd(proxy.terminalId));
		proxy.onRequestLatency(() => this._onRequestLatency(proxy.terminalId));
	}

	public $sendProcessTitle(terminalId: number, title: string): void {
		const terminalProcess = this._terminalProcessProxies.get(terminalId);
		if (terminalProcess) {
			terminalProcess.emitTitle(title);
		}
	}

	public $sendProcessData(terminalId: number, data: string): void {
		const terminalProcess = this._terminalProcessProxies.get(terminalId);
		if (terminalProcess) {
			terminalProcess.emitData(data);
		}
	}

	public $sendProcessReady(terminalId: number, pid: number, cwd: string): void {
		const terminalProcess = this._terminalProcessProxies.get(terminalId);
		if (terminalProcess) {
			terminalProcess.emitReady(pid, cwd);
		}
	}

	public $sendProcessExit(terminalId: number, exitCode: number | undefined): void {
		const terminalProcess = this._terminalProcessProxies.get(terminalId);
		if (terminalProcess) {
			terminalProcess.emitExit(exitCode);
			this._terminalProcessProxies.delete(terminalId);
		}
	}

	public $sendOverrideDimensions(terminalId: number, dimensions: ITerminalDimensions | undefined): void {
		const terminalProcess = this._terminalProcessProxies.get(terminalId);
		if (terminalProcess) {
			terminalProcess.emitOverrideDimensions(dimensions);
		}
	}

	public $sendProcessInitialCwd(terminalId: number, initialCwd: string): void {
		const terminalProcess = this._terminalProcessProxies.get(terminalId);
		if (terminalProcess) {
			terminalProcess.emitInitialCwd(initialCwd);
		}
	}

	public $sendProcessCwd(terminalId: number, cwd: string): void {
		const terminalProcess = this._terminalProcessProxies.get(terminalId);
		if (terminalProcess) {
			terminalProcess.emitCwd(cwd);
		}
	}

	public $sendResolvedLaunchConfig(terminalId: number, shellLaunchConfig: IShellLaunchConfig): void {
		const instance = this._terminalService.getInstanceFromId(terminalId);
		if (instance) {
			this._getTerminalProcess(terminalId)?.emitResolvedShellLaunchConfig(shellLaunchConfig);
		}
	}

	private async _onRequestLatency(terminalId: number): Promise<void> {
		const COUNT = 2;
		let sum = 0;
		for (let i = 0; i < COUNT; i++) {
			const sw = StopWatch.create(true);
			await this._proxy.$acceptProcessRequestLatency(terminalId);
			sw.stop();
			sum += sw.elapsed();
		}
		this._getTerminalProcess(terminalId)?.emitLatency(sum / COUNT);
	}

	private _isPrimaryExtHost(): boolean {
		// The "primary" ext host is the remote ext host if there is one, otherwise the local
		const conn = this._remoteAgentService.getConnection();
		if (conn) {
			return this._remoteAuthority === conn.remoteAuthority;
		}
		return true;
	}

	private async _onRequestAvailableShells(req: IAvailableShellsRequest): Promise<void> {
		if (this._isPrimaryExtHost()) {
			req.callback(await this._proxy.$getAvailableShells());
		}
	}

	private async _onRequestDefaultShellAndArgs(req: IDefaultShellAndArgsRequest): Promise<void> {
		if (this._isPrimaryExtHost()) {
			const res = await this._proxy.$getDefaultShellAndArgs(req.useAutomationShell);
			req.callback(res.shell, res.args);
		}
	}

	private _getTerminalProcess(terminalId: number): ITerminalProcessExtHostProxy | undefined {
		const terminal = this._terminalProcessProxies.get(terminalId);
		if (!terminal) {
			this._logService.error(`Unknown terminal: ${terminalId}`);
			return undefined;
		}
		return terminal;
	}

	$setEnvironmentVariableCollection(extensionIdentifier: string, persistent: boolean, collection: ISerializableEnvironmentVariableCollection | undefined): void {
		if (collection) {
			const translatedCollection = {
				persistent,
				map: deserializeEnvironmentVariableCollection(collection)
			};
			this._environmentVariableService.set(extensionIdentifier, translatedCollection);
		} else {
			this._environmentVariableService.delete(extensionIdentifier);
		}
	}
}

/**
 * Encapsulates temporary tracking of data events from terminal instances, once disposed all
 * listeners are removed.
 */
class TerminalDataEventTracker extends Disposable {
	private readonly _bufferer: TerminalDataBufferer;

	constructor(
		private readonly _callback: (id: number, data: string) => void,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super();

		this._register(this._bufferer = new TerminalDataBufferer(this._callback));

		this._terminalService.terminalInstances.forEach(instance => this._registerInstance(instance));
		this._register(this._terminalService.onInstanceCreated(instance => this._registerInstance(instance)));
		this._register(this._terminalService.onInstanceDisposed(instance => this._bufferer.stopBuffering(instance.id)));
	}

	private _registerInstance(instance: ITerminalInstance): void {
		// Buffer data events to reduce the amount of messages going to the extension host
		this._register(this._bufferer.startBuffering(instance.id, instance.onData));
	}
}

class ExtensionTerminalLinkProvider implements ITerminalExternalLinkProvider {
	constructor(
		private readonly _proxy: ExtHostTerminalServiceShape
	) {
	}

	async provideLinks(instance: ITerminalInstance, line: string): Promise<ITerminalLink[] | undefined> {
		const proxy = this._proxy;
		const extHostLinks = await proxy.$provideLinks(instance.id, line);
		return extHostLinks.map(dto => ({
			id: dto.id,
			startIndex: dto.startIndex,
			length: dto.length,
			label: dto.label,
			activate: () => proxy.$activateLink(instance.id, dto.id)
		}));
	}
}
