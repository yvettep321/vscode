/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { HierarchicalByLocationProjection } from 'vs/workbench/contrib/testing/browser/explorerProjections/hierarchalByLocation';
import { testStubs } from 'vs/workbench/contrib/testing/common/testStubs';
import { makeTestWorkspaceFolder, TestTreeTestHarness } from 'vs/workbench/contrib/testing/test/browser/testObjectTree';

suite('Workbench - Testing Explorer Hierarchal by Location Projection', () => {
	let harness: TestTreeTestHarness;
	const folder1 = makeTestWorkspaceFolder('f1');
	const folder2 = makeTestWorkspaceFolder('f2');
	setup(() => {
		harness = new TestTreeTestHarness(l => new HierarchicalByLocationProjection(l));
	});

	teardown(() => {
		harness.dispose();
	});

	test('renders initial tree', () => {
		harness.c.addRoot(testStubs.nested(), 'a');
		assert.deepStrictEqual(harness.flush(folder1), [
			{ e: 'a', children: [{ e: 'aa' }, { e: 'ab' }] }, { e: 'b' }
		]);
	});

	test('updates render if a second folder is added', () => {
		harness.c.addRoot(testStubs.nested(), 'a');
		harness.flush(folder1);
		harness.c.addRoot(testStubs.nested(), 'a');
		harness.flush(folder2);
		assert.deepStrictEqual(harness.flush(folder1), [
			{ e: 'f1', children: [{ e: 'a', children: [{ e: 'aa' }, { e: 'ab' }] }, { e: 'b' }] },
			{ e: 'f2', children: [{ e: 'a', children: [{ e: 'aa' }, { e: 'ab' }] }, { e: 'b' }] },
		]);
	});

	test('updates render if second folder is removed', () => {
		harness.c.addRoot(testStubs.nested(), 'a');
		harness.flush(folder1);
		harness.c.addRoot(testStubs.nested(), 'a');
		harness.flush(folder2);
		harness.onFolderChange.fire({ added: [], changed: [], removed: [folder1] });
		assert.deepStrictEqual(harness.flush(folder1), [
			{ e: 'a', children: [{ e: 'aa' }, { e: 'ab' }] }, { e: 'b' },
		]);
	});

	test('updates render if second test provider appears', () => {
		harness.c.addRoot(testStubs.nested(), 'a');
		harness.flush(folder1);
		harness.c.addRoot({
			...testStubs.test('root2'),
			children: [testStubs.test('c')]
		}, 'b');
		assert.deepStrictEqual(harness.flush(folder1), [
			{ e: 'root', children: [{ e: 'a', children: [{ e: 'aa' }, { e: 'ab' }] }, { e: 'b' }] },
			{ e: 'root2', children: [{ e: 'c' }] },
		]);
	});

	test('updates nodes if they add children', () => {
		const tests = testStubs.nested();
		harness.c.addRoot(tests, 'a');
		harness.flush(folder1);

		tests.children[0].children?.push(testStubs.test('ac'));
		harness.c.onItemChange(tests.children[0], 'a');

		assert.deepStrictEqual(harness.flush(folder1), [
			{ e: 'a', children: [{ e: 'aa' }, { e: 'ab' }, { e: 'ac' }] },
			{ e: 'b' }
		]);
	});

	test('updates nodes if they remove children', () => {
		const tests = testStubs.nested();
		harness.c.addRoot(tests, 'a');
		harness.flush(folder1);

		tests.children[0].children?.pop();
		harness.c.onItemChange(tests.children[0], 'a');

		assert.deepStrictEqual(harness.flush(folder1), [
			{ e: 'a', children: [{ e: 'aa' }] },
			{ e: 'b' }
		]);
	});
});

