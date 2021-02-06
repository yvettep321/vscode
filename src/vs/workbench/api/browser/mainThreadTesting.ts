/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { getTestSubscriptionKey, RunTestsRequest, RunTestsResult, TestDiffOpType, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { ITestService } from 'vs/workbench/contrib/testing/common/testService';
import { ExtHostContext, ExtHostTestingResource, ExtHostTestingShape, IExtHostContext, MainContext, MainThreadTestingShape } from '../common/extHost.protocol';

const reviveDiff = (diff: TestsDiff) => {
	for (const entry of diff) {
		if (entry[0] === TestDiffOpType.Add || entry[0] === TestDiffOpType.Update) {
			const item = entry[1];
			if (item.item.location) {
				item.item.location.uri = URI.revive(item.item.location.uri);
			}

			for (const message of item.item.state.messages) {
				if (message.location) {
					message.location.uri = URI.revive(message.location.uri);
				}
			}
		}
	}
};

@extHostNamedCustomer(MainContext.MainThreadTesting)
export class MainThreadTesting extends Disposable implements MainThreadTestingShape {
	private readonly proxy: ExtHostTestingShape;
	private readonly testSubscriptions = new Map<string, IDisposable>();

	constructor(
		extHostContext: IExtHostContext,
		@ITestService private readonly testService: ITestService,
		@ITestResultService resultService: ITestResultService,
	) {
		super();
		this.proxy = extHostContext.getProxy(ExtHostContext.ExtHostTesting);
		this._register(this.testService.onShouldSubscribe(args => this.proxy.$subscribeToTests(args.resource, args.uri)));
		this._register(this.testService.onShouldUnsubscribe(args => this.proxy.$unsubscribeFromTests(args.resource, args.uri)));

		const testCompleteListener = this._register(new MutableDisposable());
		this._register(resultService.onNewTestResult(results => {
			testCompleteListener.value = results.onComplete(() => this.proxy.$publishTestResults({ tests: results.tests }));
		}));

		testService.updateRootProviderCount(1);

		const lastCompleted = resultService.results.find(r => !r.isComplete);
		if (lastCompleted) {
			this.proxy.$publishTestResults({ tests: lastCompleted.tests });
		}

		for (const { resource, uri } of this.testService.subscriptions) {
			this.proxy.$subscribeToTests(resource, uri);
		}
	}

	/**
	 * @inheritdoc
	 */
	public $registerTestProvider(id: string) {
		this.testService.registerTestController(id, {
			runTests: (req, token) => this.proxy.$runTestsForProvider(req, token),
			lookupTest: test => this.proxy.$lookupTest(test),
		});
	}

	/**
	 * @inheritdoc
	 */
	public $unregisterTestProvider(id: string) {
		this.testService.unregisterTestController(id);
	}

	/**
	 * @inheritdoc
	 */
	$subscribeToDiffs(resource: ExtHostTestingResource, uriComponents: UriComponents): void {
		const uri = URI.revive(uriComponents);
		const disposable = this.testService.subscribeToDiffs(resource, uri,
			diff => this.proxy.$acceptDiff(resource, uriComponents, diff));
		this.testSubscriptions.set(getTestSubscriptionKey(resource, uri), disposable);
	}

	/**
	 * @inheritdoc
	 */
	public $unsubscribeFromDiffs(resource: ExtHostTestingResource, uriComponents: UriComponents): void {
		const key = getTestSubscriptionKey(resource, URI.revive(uriComponents));
		this.testSubscriptions.get(key)?.dispose();
		this.testSubscriptions.delete(key);
	}

	/**
	 * @inheritdoc
	 */
	public $publishDiff(resource: ExtHostTestingResource, uri: UriComponents, diff: TestsDiff): void {
		reviveDiff(diff);
		this.testService.publishDiff(resource, URI.revive(uri), diff);
	}

	public $runTests(req: RunTestsRequest, token: CancellationToken): Promise<RunTestsResult> {
		return this.testService.runTests(req, token);
	}

	public dispose() {
		this.testService.updateRootProviderCount(-1);
		for (const subscription of this.testSubscriptions.values()) {
			subscription.dispose();
		}
		this.testSubscriptions.clear();
	}
}
