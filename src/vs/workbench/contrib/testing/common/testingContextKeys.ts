/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ViewContainerLocation } from 'vs/workbench/common/views';
import { TestExplorerViewMode, TestExplorerViewGrouping } from 'vs/workbench/contrib/testing/common/constants';

export namespace TestingContextKeys {
	export const providerCount = new RawContextKey('testing.providerCount', 0);
	export const viewMode = new RawContextKey('testing.explorerViewMode', TestExplorerViewMode.List);
	export const viewGrouping = new RawContextKey('testing.explorerViewGrouping', TestExplorerViewGrouping.ByLocation);
	export const isRunning = new RawContextKey('testing.isRunning', false);
	export const isInPeek = new RawContextKey('testing.isInPeek', true);
	export const isPeekVisible = new RawContextKey('testing.isPeekVisible', false);
	export const explorerLocation = new RawContextKey('testing.explorerLocation', ViewContainerLocation.Sidebar);
}
