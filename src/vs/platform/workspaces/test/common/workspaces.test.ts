/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { hasWorkspaceFileExtension, toWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';

suite('Workspaces', () => {

	test('hasWorkspaceFileExtension', () => {
		assert.strictEqual(hasWorkspaceFileExtension('something'), false);
		assert.strictEqual(hasWorkspaceFileExtension('something.code-workspace'), true);
	});

	test('toWorkspaceIdentifier', () => {
		let identifier = toWorkspaceIdentifier({ id: 'id', folders: [] });
		assert.ok(!identifier);
		assert.ok(!isSingleFolderWorkspaceIdentifier(identifier));
		assert.ok(!isWorkspaceIdentifier(identifier));

		identifier = toWorkspaceIdentifier({ id: 'id', folders: [{ index: 0, name: 'test', toResource: () => URI.file('test'), uri: URI.file('test') }] });
		assert.ok(identifier);
		assert.ok(isSingleFolderWorkspaceIdentifier(identifier));
		assert.ok(!isWorkspaceIdentifier(identifier));

		identifier = toWorkspaceIdentifier({ id: 'id', configuration: URI.file('test.code-workspace'), folders: [] });
		assert.ok(identifier);
		assert.ok(!isSingleFolderWorkspaceIdentifier(identifier));
		assert.ok(isWorkspaceIdentifier(identifier));
	});
});
