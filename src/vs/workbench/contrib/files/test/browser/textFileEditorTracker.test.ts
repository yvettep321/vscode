/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { TextFileEditorTracker } from 'vs/workbench/contrib/files/browser/editors/textFileEditorTracker';
import { toResource } from 'vs/base/test/common/utils';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { workbenchInstantiationService, TestServiceAccessor, TestFilesConfigurationService, registerTestFileEditor, registerTestResourceEditor } from 'vs/workbench/test/browser/workbenchTestServices';
import { IResolvedTextFileEditorModel, snapshotToString, ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { FileChangesEvent, FileChangeType } from 'vs/platform/files/common/files';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { timeout } from 'vs/base/common/async';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

suite('Files - TextFileEditorTracker', () => {

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestFileEditor());
		disposables.add(registerTestResourceEditor());
	});

	teardown(() => {
		disposables.clear();
	});

	async function createTracker(autoSaveEnabled = false): Promise<TestServiceAccessor> {
		const instantiationService = workbenchInstantiationService();

		if (autoSaveEnabled) {
			const configurationService = new TestConfigurationService();
			configurationService.setUserConfiguration('files', { autoSave: 'afterDelay', autoSaveDelay: 1 });

			instantiationService.stub(IConfigurationService, configurationService);

			instantiationService.stub(IFilesConfigurationService, new TestFilesConfigurationService(
				<IContextKeyService>instantiationService.createInstance(MockContextKeyService),
				configurationService
			));
		}

		const part = disposables.add(instantiationService.createInstance(EditorPart));
		part.create(document.createElement('div'));
		part.layout(400, 300);

		instantiationService.stub(IEditorGroupsService, part);

		const editorService: EditorService = instantiationService.createInstance(EditorService);
		instantiationService.stub(IEditorService, editorService);

		const accessor = instantiationService.createInstance(TestServiceAccessor);
		disposables.add((<TextFileEditorModelManager>accessor.textFileService.files));

		await part.whenRestored;

		disposables.add(instantiationService.createInstance(TextFileEditorTracker));

		return accessor;
	}

	test('file change event updates model', async function () {
		const accessor = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');

		const model = await accessor.textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;

		model.textEditorModel.setValue('Super Good');
		assert.strictEqual(snapshotToString(model.createSnapshot()!), 'Super Good');

		await model.save();

		// change event (watcher)
		accessor.fileService.fireFileChanges(new FileChangesEvent([{ resource, type: FileChangeType.UPDATED }], false));

		await timeout(0); // due to event updating model async

		assert.strictEqual(snapshotToString(model.createSnapshot()!), 'Hello Html');
	});

	test('dirty text file model opens as editor', async function () {
		const resource = toResource.call(this, '/path/index.txt');

		await testDirtyTextFileModelOpensEditorDependingOnAutoSaveSetting(resource, false);
	});

	test('dirty text file model does not open as editor if autosave is ON', async function () {
		const resource = toResource.call(this, '/path/index.txt');

		await testDirtyTextFileModelOpensEditorDependingOnAutoSaveSetting(resource, true);
	});

	async function testDirtyTextFileModelOpensEditorDependingOnAutoSaveSetting(resource: URI, autoSave: boolean): Promise<void> {
		const accessor = await createTracker(autoSave);

		assert.ok(!accessor.editorService.isOpen(accessor.editorService.createEditorInput({ resource, forceFile: true })));

		const model = await accessor.textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;

		model.textEditorModel.setValue('Super Good');

		if (autoSave) {
			await timeout(100);
			assert.ok(!accessor.editorService.isOpen(accessor.editorService.createEditorInput({ resource, forceFile: true })));
		} else {
			await awaitEditorOpening(accessor.editorService);
			assert.ok(accessor.editorService.isOpen(accessor.editorService.createEditorInput({ resource, forceFile: true })));
		}
	}

	test('dirty untitled text file model opens as editor', async function () {
		const accessor = await createTracker();

		const untitledEditor = accessor.editorService.createEditorInput({ forceUntitled: true }) as UntitledTextEditorInput;
		const model = disposables.add(await untitledEditor.resolve());

		assert.ok(!accessor.editorService.isOpen(untitledEditor));

		model.textEditorModel.setValue('Super Good');

		await awaitEditorOpening(accessor.editorService);
		assert.ok(accessor.editorService.isOpen(untitledEditor));
	});

	function awaitEditorOpening(editorService: IEditorService): Promise<void> {
		return Event.toPromise(Event.once(editorService.onDidActiveEditorChange));
	}

	test('non-dirty files reload on window focus', async function () {
		const accessor = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');

		await accessor.editorService.openEditor(accessor.editorService.createEditorInput({ resource, forceFile: true }));

		accessor.hostService.setFocus(false);
		accessor.hostService.setFocus(true);

		await awaitModelLoadEvent(accessor.textFileService, resource);
	});

	function awaitModelLoadEvent(textFileService: ITextFileService, resource: URI): Promise<void> {
		return new Promise(resolve => {
			const listener = textFileService.files.onDidLoad(e => {
				if (isEqual(e.model.resource, resource)) {
					listener.dispose();
					resolve();
				}
			});
		});
	}
});
