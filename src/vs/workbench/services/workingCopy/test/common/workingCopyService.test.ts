/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IWorkingCopy } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { URI } from 'vs/base/common/uri';
import { TestWorkingCopy, TestWorkingCopyService } from 'vs/workbench/test/common/workbenchTestServices';

suite('WorkingCopyService', () => {

	test('registry - basics', () => {
		const service = new TestWorkingCopyService();

		const onDidChangeDirty: IWorkingCopy[] = [];
		service.onDidChangeDirty(copy => onDidChangeDirty.push(copy));

		const onDidChangeContent: IWorkingCopy[] = [];
		service.onDidChangeContent(copy => onDidChangeContent.push(copy));

		const onDidRegister: IWorkingCopy[] = [];
		service.onDidRegister(copy => onDidRegister.push(copy));

		const onDidUnregister: IWorkingCopy[] = [];
		service.onDidUnregister(copy => onDidUnregister.push(copy));

		assert.strictEqual(service.hasDirty, false);
		assert.strictEqual(service.dirtyCount, 0);
		assert.strictEqual(service.workingCopies.length, 0);
		assert.strictEqual(service.isDirty(URI.file('/')), false);

		// resource 1
		const resource1 = URI.file('/some/folder/file.txt');
		const copy1 = new TestWorkingCopy(resource1);
		const unregister1 = service.registerWorkingCopy(copy1);

		assert.strictEqual(service.workingCopies.length, 1);
		assert.strictEqual(service.workingCopies[0], copy1);
		assert.strictEqual(onDidRegister.length, 1);
		assert.strictEqual(onDidRegister[0], copy1);
		assert.strictEqual(service.dirtyCount, 0);
		assert.strictEqual(service.isDirty(resource1), false);
		assert.strictEqual(service.hasDirty, false);

		copy1.setDirty(true);

		assert.strictEqual(copy1.isDirty(), true);
		assert.strictEqual(service.dirtyCount, 1);
		assert.strictEqual(service.dirtyWorkingCopies.length, 1);
		assert.strictEqual(service.dirtyWorkingCopies[0], copy1);
		assert.strictEqual(service.workingCopies.length, 1);
		assert.strictEqual(service.workingCopies[0], copy1);
		assert.strictEqual(service.isDirty(resource1), true);
		assert.strictEqual(service.hasDirty, true);
		assert.strictEqual(onDidChangeDirty.length, 1);
		assert.strictEqual(onDidChangeDirty[0], copy1);

		copy1.setContent('foo');

		assert.strictEqual(onDidChangeContent.length, 1);
		assert.strictEqual(onDidChangeContent[0], copy1);

		copy1.setDirty(false);

		assert.strictEqual(service.dirtyCount, 0);
		assert.strictEqual(service.isDirty(resource1), false);
		assert.strictEqual(service.hasDirty, false);
		assert.strictEqual(onDidChangeDirty.length, 2);
		assert.strictEqual(onDidChangeDirty[1], copy1);

		unregister1.dispose();

		assert.strictEqual(onDidUnregister.length, 1);
		assert.strictEqual(onDidUnregister[0], copy1);
		assert.strictEqual(service.workingCopies.length, 0);

		// resource 2
		const resource2 = URI.file('/some/folder/file-dirty.txt');
		const copy2 = new TestWorkingCopy(resource2, true);
		const unregister2 = service.registerWorkingCopy(copy2);

		assert.strictEqual(onDidRegister.length, 2);
		assert.strictEqual(onDidRegister[1], copy2);
		assert.strictEqual(service.dirtyCount, 1);
		assert.strictEqual(service.isDirty(resource2), true);
		assert.strictEqual(service.hasDirty, true);

		assert.strictEqual(onDidChangeDirty.length, 3);
		assert.strictEqual(onDidChangeDirty[2], copy2);

		copy2.setContent('foo');

		assert.strictEqual(onDidChangeContent.length, 2);
		assert.strictEqual(onDidChangeContent[1], copy2);

		unregister2.dispose();

		assert.strictEqual(onDidUnregister.length, 2);
		assert.strictEqual(onDidUnregister[1], copy2);
		assert.strictEqual(service.dirtyCount, 0);
		assert.strictEqual(service.hasDirty, false);
		assert.strictEqual(onDidChangeDirty.length, 4);
		assert.strictEqual(onDidChangeDirty[3], copy2);
	});

	test('registry - multiple copies on same resource throws', () => {
		const service = new TestWorkingCopyService();

		const onDidChangeDirty: IWorkingCopy[] = [];
		service.onDidChangeDirty(copy => onDidChangeDirty.push(copy));

		const resource = URI.parse('custom://some/folder/custom.txt');

		const copy1 = new TestWorkingCopy(resource);
		service.registerWorkingCopy(copy1);

		const copy2 = new TestWorkingCopy(resource);

		assert.throws(() => service.registerWorkingCopy(copy2));
	});
});
