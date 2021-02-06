/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogService, ILogService, ConsoleLogger, MultiplexLogService, ILogger, AdapterLogger } from 'vs/platform/log/common/log';
import { BufferLogService } from 'vs/platform/log/common/bufferLog';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { LoggerChannelClient, FollowerLogService } from 'vs/platform/log/common/logIpc';
import { SpdLogLogger } from 'vs/platform/log/node/spdlogLog';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';

export class NativeLogService extends LogService {

	private readonly bufferSpdLogService: BufferLogService | undefined;
	private readonly windowId: number;
	private readonly environmentService: INativeWorkbenchEnvironmentService;

	constructor(windowId: number, mainProcessService: IMainProcessService, environmentService: INativeWorkbenchEnvironmentService) {

		const disposables = new DisposableStore();
		const loggerClient = new LoggerChannelClient(mainProcessService.getChannel('logger'));
		let bufferSpdLogService: BufferLogService | undefined;

		// Extension development test CLI: forward everything to main side
		const loggers: ILogger[] = [];
		if (environmentService.isExtensionDevelopment && !!environmentService.extensionTestsLocationURI) {
			loggers.push(
				disposables.add(new AdapterLogger({ log: (type, args) => loggerClient.consoleLog(type, args) }, environmentService.configuration.logLevel))
			);
		}

		// Normal logger: spdylog and console
		else {
			bufferSpdLogService = disposables.add(new BufferLogService(environmentService.configuration.logLevel));
			loggers.push(
				disposables.add(new ConsoleLogger(environmentService.configuration.logLevel)),
				bufferSpdLogService
			);
		}

		const multiplexLogger = disposables.add(new MultiplexLogService(loggers));
		const followerLogger = disposables.add(new FollowerLogService(loggerClient, multiplexLogger));
		super(followerLogger);

		this.bufferSpdLogService = bufferSpdLogService;
		this.windowId = windowId;
		this.environmentService = environmentService;

		this._register(disposables);
	}

	init(): void {
		if (this.bufferSpdLogService) {
			this.bufferSpdLogService.logger = this._register(new SpdLogLogger(`renderer${this.windowId}`, this.environmentService.logsPath, this.getLevel()));
			this.trace('Created Spdlogger');
		}
	}
}

class NativeLogServiceInitContribution implements IWorkbenchContribution {
	constructor(@ILogService logService: ILogService) {
		if (logService instanceof NativeLogService) {
			logService.init();
		}
	}
}
Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench).registerWorkbenchContribution(NativeLogServiceInitContribution, LifecyclePhase.Restored);
