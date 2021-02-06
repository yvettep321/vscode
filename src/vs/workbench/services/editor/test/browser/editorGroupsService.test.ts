/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { workbenchInstantiationService, registerTestEditor, TestFileEditorInput, TestEditorPart, ITestInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { GroupDirection, GroupsOrder, MergeGroupMode, GroupOrientation, GroupChangeKind, GroupLocation, OpenEditorContext } from 'vs/workbench/services/editor/common/editorGroupsService';
import { EditorOptions, CloseDirection, IEditorPartOptions, EditorsOrder } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { MockScopableContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';

suite('EditorGroupsService', () => {

	const TEST_EDITOR_ID = 'MyFileEditorForEditorGroupService';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForEditorGroupService';

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)], TEST_EDITOR_INPUT_ID));
	});

	teardown(() => {
		disposables.clear();
	});

	function createPart(instantiationService = workbenchInstantiationService()): [TestEditorPart, ITestInstantiationService] {
		const part = disposables.add(instantiationService.createInstance(TestEditorPart));
		part.create(document.createElement('div'));
		part.layout(400, 300);

		return [part, instantiationService];
	}

	test('groups basics', async function () {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) });
		const [part] = createPart(instantiationService);

		let activeGroupChangeCounter = 0;
		const activeGroupChangeListener = part.onDidActiveGroupChange(() => {
			activeGroupChangeCounter++;
		});

		let groupAddedCounter = 0;
		const groupAddedListener = part.onDidAddGroup(() => {
			groupAddedCounter++;
		});

		let groupRemovedCounter = 0;
		const groupRemovedListener = part.onDidRemoveGroup(() => {
			groupRemovedCounter++;
		});

		let groupMovedCounter = 0;
		const groupMovedListener = part.onDidMoveGroup(() => {
			groupMovedCounter++;
		});

		// always a root group
		const rootGroup = part.groups[0];
		assert.strictEqual(part.groups.length, 1);
		assert.strictEqual(part.count, 1);
		assert.strictEqual(rootGroup, part.getGroup(rootGroup.id));
		assert.ok(part.activeGroup === rootGroup);
		assert.strictEqual(rootGroup.label, 'Group 1');

		let mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.strictEqual(mru.length, 1);
		assert.strictEqual(mru[0], rootGroup);

		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		assert.strictEqual(rightGroup, part.getGroup(rightGroup.id));
		assert.strictEqual(groupAddedCounter, 1);
		assert.strictEqual(part.groups.length, 2);
		assert.strictEqual(part.count, 2);
		assert.ok(part.activeGroup === rootGroup);
		assert.strictEqual(rootGroup.label, 'Group 1');
		assert.strictEqual(rightGroup.label, 'Group 2');

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.strictEqual(mru.length, 2);
		assert.strictEqual(mru[0], rootGroup);
		assert.strictEqual(mru[1], rightGroup);

		assert.strictEqual(activeGroupChangeCounter, 0);

		let rootGroupActiveChangeCounter = 0;
		const rootGroupChangeListener = rootGroup.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.GROUP_ACTIVE) {
				rootGroupActiveChangeCounter++;
			}
		});

		let rightGroupActiveChangeCounter = 0;
		const rightGroupChangeListener = rightGroup.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.GROUP_ACTIVE) {
				rightGroupActiveChangeCounter++;
			}
		});

		part.activateGroup(rightGroup);
		assert.ok(part.activeGroup === rightGroup);
		assert.strictEqual(activeGroupChangeCounter, 1);
		assert.strictEqual(rootGroupActiveChangeCounter, 1);
		assert.strictEqual(rightGroupActiveChangeCounter, 1);

		rootGroupChangeListener.dispose();
		rightGroupChangeListener.dispose();

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.strictEqual(mru.length, 2);
		assert.strictEqual(mru[0], rightGroup);
		assert.strictEqual(mru[1], rootGroup);

		const downGroup = part.addGroup(rightGroup, GroupDirection.DOWN);
		let didDispose = false;
		downGroup.onWillDispose(() => {
			didDispose = true;
		});
		assert.strictEqual(groupAddedCounter, 2);
		assert.strictEqual(part.groups.length, 3);
		assert.ok(part.activeGroup === rightGroup);
		assert.ok(!downGroup.activeEditorPane);
		assert.strictEqual(rootGroup.label, 'Group 1');
		assert.strictEqual(rightGroup.label, 'Group 2');
		assert.strictEqual(downGroup.label, 'Group 3');

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.strictEqual(mru.length, 3);
		assert.strictEqual(mru[0], rightGroup);
		assert.strictEqual(mru[1], rootGroup);
		assert.strictEqual(mru[2], downGroup);

		const gridOrder = part.getGroups(GroupsOrder.GRID_APPEARANCE);
		assert.strictEqual(gridOrder.length, 3);
		assert.strictEqual(gridOrder[0], rootGroup);
		assert.strictEqual(gridOrder[0].index, 0);
		assert.strictEqual(gridOrder[1], rightGroup);
		assert.strictEqual(gridOrder[1].index, 1);
		assert.strictEqual(gridOrder[2], downGroup);
		assert.strictEqual(gridOrder[2].index, 2);

		part.moveGroup(downGroup, rightGroup, GroupDirection.DOWN);
		assert.strictEqual(groupMovedCounter, 1);

		part.removeGroup(downGroup);
		assert.ok(!part.getGroup(downGroup.id));
		assert.strictEqual(didDispose, true);
		assert.strictEqual(groupRemovedCounter, 1);
		assert.strictEqual(part.groups.length, 2);
		assert.ok(part.activeGroup === rightGroup);
		assert.strictEqual(rootGroup.label, 'Group 1');
		assert.strictEqual(rightGroup.label, 'Group 2');

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.strictEqual(mru.length, 2);
		assert.strictEqual(mru[0], rightGroup);
		assert.strictEqual(mru[1], rootGroup);

		const rightGroupContextKeyService = part.activeGroup.scopedContextKeyService;
		const rootGroupContextKeyService = rootGroup.scopedContextKeyService;

		assert.ok(rightGroupContextKeyService);
		assert.ok(rootGroupContextKeyService);
		assert.ok(rightGroupContextKeyService !== rootGroupContextKeyService);

		part.removeGroup(rightGroup);
		assert.strictEqual(groupRemovedCounter, 2);
		assert.strictEqual(part.groups.length, 1);
		assert.ok(part.activeGroup === rootGroup);

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.strictEqual(mru.length, 1);
		assert.strictEqual(mru[0], rootGroup);

		part.removeGroup(rootGroup); // cannot remove root group
		assert.strictEqual(part.groups.length, 1);
		assert.strictEqual(groupRemovedCounter, 2);
		assert.ok(part.activeGroup === rootGroup);

		part.setGroupOrientation(part.orientation === GroupOrientation.HORIZONTAL ? GroupOrientation.VERTICAL : GroupOrientation.HORIZONTAL);

		activeGroupChangeListener.dispose();
		groupAddedListener.dispose();
		groupRemovedListener.dispose();
		groupMovedListener.dispose();
	});

	test('save & restore state', async function () {
		let [part, instantiationService] = createPart();

		const rootGroup = part.groups[0];
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		const downGroup = part.addGroup(rightGroup, GroupDirection.DOWN);

		const rootGroupInput = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		await rootGroup.openEditor(rootGroupInput, EditorOptions.create({ pinned: true }));

		const rightGroupInput = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		await rightGroup.openEditor(rightGroupInput, EditorOptions.create({ pinned: true }));

		assert.strictEqual(part.groups.length, 3);

		part.saveState();
		part.dispose();

		let [restoredPart] = createPart(instantiationService);

		assert.strictEqual(restoredPart.groups.length, 3);
		assert.ok(restoredPart.getGroup(rootGroup.id));
		assert.ok(restoredPart.getGroup(rightGroup.id));
		assert.ok(restoredPart.getGroup(downGroup.id));

		restoredPart.clearState();
	});

	test('groups index / labels', function () {
		const [part] = createPart();

		const rootGroup = part.groups[0];
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		const downGroup = part.addGroup(rightGroup, GroupDirection.DOWN);

		let groupIndexChangedCounter = 0;
		const groupIndexChangedListener = part.onDidGroupIndexChange(() => {
			groupIndexChangedCounter++;
		});

		let indexChangeCounter = 0;
		const labelChangeListener = downGroup.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.GROUP_INDEX) {
				indexChangeCounter++;
			}
		});

		assert.strictEqual(rootGroup.index, 0);
		assert.strictEqual(rightGroup.index, 1);
		assert.strictEqual(downGroup.index, 2);
		assert.strictEqual(rootGroup.label, 'Group 1');
		assert.strictEqual(rightGroup.label, 'Group 2');
		assert.strictEqual(downGroup.label, 'Group 3');

		part.removeGroup(rightGroup);
		assert.strictEqual(rootGroup.index, 0);
		assert.strictEqual(downGroup.index, 1);
		assert.strictEqual(rootGroup.label, 'Group 1');
		assert.strictEqual(downGroup.label, 'Group 2');
		assert.strictEqual(indexChangeCounter, 1);
		assert.strictEqual(groupIndexChangedCounter, 1);

		part.moveGroup(downGroup, rootGroup, GroupDirection.UP);
		assert.strictEqual(downGroup.index, 0);
		assert.strictEqual(rootGroup.index, 1);
		assert.strictEqual(downGroup.label, 'Group 1');
		assert.strictEqual(rootGroup.label, 'Group 2');
		assert.strictEqual(indexChangeCounter, 2);
		assert.strictEqual(groupIndexChangedCounter, 3);

		const newFirstGroup = part.addGroup(downGroup, GroupDirection.UP);
		assert.strictEqual(newFirstGroup.index, 0);
		assert.strictEqual(downGroup.index, 1);
		assert.strictEqual(rootGroup.index, 2);
		assert.strictEqual(newFirstGroup.label, 'Group 1');
		assert.strictEqual(downGroup.label, 'Group 2');
		assert.strictEqual(rootGroup.label, 'Group 3');
		assert.strictEqual(indexChangeCounter, 3);
		assert.strictEqual(groupIndexChangedCounter, 6);

		labelChangeListener.dispose();
		groupIndexChangedListener.dispose();
	});

	test('copy/merge groups', async () => {
		const [part] = createPart();

		let groupAddedCounter = 0;
		const groupAddedListener = part.onDidAddGroup(() => {
			groupAddedCounter++;
		});

		let groupRemovedCounter = 0;
		const groupRemovedListener = part.onDidRemoveGroup(() => {
			groupRemovedCounter++;
		});

		const rootGroup = part.groups[0];
		let rootGroupDisposed = false;
		const disposeListener = rootGroup.onWillDispose(() => {
			rootGroupDisposed = true;
		});

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input, EditorOptions.create({ pinned: true }));
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT, { activate: true });
		const downGroup = part.copyGroup(rootGroup, rightGroup, GroupDirection.DOWN);
		assert.strictEqual(groupAddedCounter, 2);
		assert.strictEqual(downGroup.count, 1);
		assert.ok(downGroup.activeEditor instanceof TestFileEditorInput);
		part.mergeGroup(rootGroup, rightGroup, { mode: MergeGroupMode.COPY_EDITORS });
		assert.strictEqual(rightGroup.count, 1);
		assert.ok(rightGroup.activeEditor instanceof TestFileEditorInput);
		part.mergeGroup(rootGroup, rightGroup, { mode: MergeGroupMode.MOVE_EDITORS });
		assert.strictEqual(rootGroup.count, 0);
		part.mergeGroup(rootGroup, downGroup);
		assert.strictEqual(groupRemovedCounter, 1);
		assert.strictEqual(rootGroupDisposed, true);

		groupAddedListener.dispose();
		groupRemovedListener.dispose();
		disposeListener.dispose();
		part.dispose();
	});

	test('whenRestored', async () => {
		const [part] = createPart();

		await part.whenRestored;
		assert.ok(true);
	});

	test('options', () => {
		const [part] = createPart();

		let oldOptions!: IEditorPartOptions;
		let newOptions!: IEditorPartOptions;
		part.onDidEditorPartOptionsChange(event => {
			oldOptions = event.oldPartOptions;
			newOptions = event.newPartOptions;
		});

		const currentOptions = part.partOptions;
		assert.ok(currentOptions);

		part.enforcePartOptions({ showTabs: false });
		assert.strictEqual(part.partOptions.showTabs, false);
		assert.strictEqual(newOptions.showTabs, false);
		assert.strictEqual(oldOptions, currentOptions);
	});

	test('editor basics', async function () {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		await part.whenRestored;

		let editorWillOpenCounter = 0;
		const editorWillOpenListener = group.onWillOpenEditor(() => {
			editorWillOpenCounter++;
		});

		let activeEditorChangeCounter = 0;
		let editorDidOpenCounter = 0;
		let editorCloseCounter = 0;
		let editorPinCounter = 0;
		let editorStickyCounter = 0;
		const editorGroupChangeListener = group.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.EDITOR_OPEN) {
				assert.ok(e.editor);
				editorDidOpenCounter++;
			} else if (e.kind === GroupChangeKind.EDITOR_ACTIVE) {
				assert.ok(e.editor);
				activeEditorChangeCounter++;
			} else if (e.kind === GroupChangeKind.EDITOR_CLOSE) {
				assert.ok(e.editor);
				editorCloseCounter++;
			} else if (e.kind === GroupChangeKind.EDITOR_PIN) {
				assert.ok(e.editor);
				editorPinCounter++;
			} else if (e.kind === GroupChangeKind.EDITOR_STICKY) {
				assert.ok(e.editor);
				editorStickyCounter++;
			}
		});

		let editorCloseCounter1 = 0;
		const editorCloseListener = group.onDidCloseEditor(() => {
			editorCloseCounter1++;
		});

		let editorWillCloseCounter = 0;
		const editorWillCloseListener = group.onWillCloseEditor(() => {
			editorWillCloseCounter++;
		});

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditor(input, EditorOptions.create({ pinned: true }));
		await group.openEditor(inputInactive, EditorOptions.create({ inactive: true }));

		assert.strictEqual(group.isActive(input), true);
		assert.strictEqual(group.isActive(inputInactive), false);
		assert.strictEqual(group.isOpened(input), true);
		assert.strictEqual(group.isOpened(inputInactive), true);
		assert.strictEqual(group.isEmpty, false);
		assert.strictEqual(group.count, 2);
		assert.strictEqual(editorWillOpenCounter, 2);
		assert.strictEqual(editorDidOpenCounter, 2);
		assert.strictEqual(activeEditorChangeCounter, 1);
		assert.strictEqual(group.getEditorByIndex(0), input);
		assert.strictEqual(group.getEditorByIndex(1), inputInactive);
		assert.strictEqual(group.getIndexOfEditor(input), 0);
		assert.strictEqual(group.getIndexOfEditor(inputInactive), 1);

		assert.strictEqual(group.previewEditor, inputInactive);
		assert.strictEqual(group.isPinned(inputInactive), false);
		group.pinEditor(inputInactive);
		assert.strictEqual(editorPinCounter, 1);
		assert.strictEqual(group.isPinned(inputInactive), true);
		assert.ok(!group.previewEditor);

		assert.strictEqual(group.activeEditor, input);
		assert.strictEqual(group.activeEditorPane?.getId(), TEST_EDITOR_ID);
		assert.strictEqual(group.count, 2);

		const mru = group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE);
		assert.strictEqual(mru[0], input);
		assert.strictEqual(mru[1], inputInactive);

		await group.openEditor(inputInactive);
		assert.strictEqual(activeEditorChangeCounter, 2);
		assert.strictEqual(group.activeEditor, inputInactive);

		await group.openEditor(input);
		await group.closeEditor(inputInactive);

		assert.strictEqual(activeEditorChangeCounter, 3);
		assert.strictEqual(editorCloseCounter, 1);
		assert.strictEqual(editorCloseCounter1, 1);
		assert.strictEqual(editorWillCloseCounter, 1);

		assert.ok(inputInactive.gotDisposed);

		assert.strictEqual(group.activeEditor, input);

		assert.strictEqual(editorStickyCounter, 0);
		group.stickEditor(input);
		assert.strictEqual(editorStickyCounter, 1);
		group.unstickEditor(input);
		assert.strictEqual(editorStickyCounter, 2);

		editorCloseListener.dispose();
		editorWillCloseListener.dispose();
		editorWillOpenListener.dispose();
		editorGroupChangeListener.dispose();
	});

	test('openEditors / closeEditors', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input, options: { pinned: true } },
			{ editor: inputInactive }
		]);

		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input);
		assert.strictEqual(group.getEditorByIndex(1), inputInactive);

		await group.closeEditors([input, inputInactive]);

		assert.ok(input.gotDisposed);
		assert.ok(inputInactive.gotDisposed);

		assert.strictEqual(group.isEmpty, true);
	});

	test('closeEditors (one, opened in multiple groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		await rightGroup.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);

		await rightGroup.closeEditor(input);

		assert.ok(!input.gotDisposed);

		await group.closeEditor(input);

		assert.ok(input.gotDisposed);
	});

	test('closeEditors (except one)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ except: input2 });
		assert.strictEqual(group.count, 1);
		assert.strictEqual(group.getEditorByIndex(0), input2);
	});

	test('closeEditors (except one, sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true, sticky: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ except: input2, excludeSticky: true });

		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);

		await group.closeEditors({ except: input2 });

		assert.strictEqual(group.count, 1);
		assert.strictEqual(group.stickyCount, 0);
		assert.strictEqual(group.getEditorByIndex(0), input2);
	});

	test('closeEditors (saved only)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ savedOnly: true });
		assert.strictEqual(group.count, 0);
	});

	test('closeEditors (saved only, sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true, sticky: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ savedOnly: true, excludeSticky: true });

		assert.strictEqual(group.count, 1);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input1);

		await group.closeEditors({ savedOnly: true });
		assert.strictEqual(group.count, 0);
	});

	test('closeEditors (direction: right)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.RIGHT, except: input2 });
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
	});

	test('closeEditors (direction: right, sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true, sticky: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.RIGHT, except: input2, excludeSticky: true });
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);

		await group.closeEditors({ direction: CloseDirection.RIGHT, except: input2 });
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
	});

	test('closeEditors (direction: left)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.LEFT, except: input2 });
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input2);
		assert.strictEqual(group.getEditorByIndex(1), input3);
	});

	test('closeEditors (direction: left, sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true, sticky: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.LEFT, except: input2, excludeSticky: true });
		assert.strictEqual(group.count, 3);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input1);
		assert.strictEqual(group.getEditorByIndex(1), input2);
		assert.strictEqual(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.LEFT, except: input2 });
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input2);
		assert.strictEqual(group.getEditorByIndex(1), input3);
	});

	test('closeAllEditors', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input, options: { pinned: true } },
			{ editor: inputInactive }
		]);

		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input);
		assert.strictEqual(group.getEditorByIndex(1), inputInactive);

		await group.closeAllEditors();
		assert.strictEqual(group.isEmpty, true);
	});

	test('closeAllEditors (sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input, options: { pinned: true, sticky: true } },
			{ editor: inputInactive }
		]);

		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.stickyCount, 1);

		await group.closeAllEditors({ excludeSticky: true });

		assert.strictEqual(group.count, 1);
		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.getEditorByIndex(0), input);

		await group.closeAllEditors();

		assert.strictEqual(group.isEmpty, true);
	});

	test('moveEditor (same group)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		let editorMoveCounter = 0;
		const editorGroupChangeListener = group.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.EDITOR_MOVE) {
				assert.ok(e.editor);
				editorMoveCounter++;
			}
		});

		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input);
		assert.strictEqual(group.getEditorByIndex(1), inputInactive);
		group.moveEditor(inputInactive, group, { index: 0 });
		assert.strictEqual(editorMoveCounter, 1);
		assert.strictEqual(group.getEditorByIndex(0), inputInactive);
		assert.strictEqual(group.getEditorByIndex(1), input);

		editorGroupChangeListener.dispose();
	});

	test('moveEditor (across groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input);
		assert.strictEqual(group.getEditorByIndex(1), inputInactive);
		group.moveEditor(inputInactive, rightGroup, { index: 0 });
		assert.strictEqual(group.count, 1);
		assert.strictEqual(group.getEditorByIndex(0), input);
		assert.strictEqual(rightGroup.count, 1);
		assert.strictEqual(rightGroup.getEditorByIndex(0), inputInactive);
	});

	test('copyEditor (across groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input);
		assert.strictEqual(group.getEditorByIndex(1), inputInactive);
		group.copyEditor(inputInactive, rightGroup, { index: 0 });
		assert.strictEqual(group.count, 2);
		assert.strictEqual(group.getEditorByIndex(0), input);
		assert.strictEqual(group.getEditorByIndex(1), inputInactive);
		assert.strictEqual(rightGroup.count, 1);
		assert.strictEqual(rightGroup.getEditorByIndex(0), inputInactive);
	});

	test('replaceEditors', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditor(input);
		assert.strictEqual(group.count, 1);
		assert.strictEqual(group.getEditorByIndex(0), input);

		await group.replaceEditors([{ editor: input, replacement: inputInactive }]);
		assert.strictEqual(group.count, 1);
		assert.strictEqual(group.getEditorByIndex(0), inputInactive);
	});

	test('find neighbour group (left/right)', function () {
		const [part] = createPart();
		const rootGroup = part.activeGroup;
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		assert.strictEqual(rightGroup, part.findGroup({ direction: GroupDirection.RIGHT }, rootGroup));
		assert.strictEqual(rootGroup, part.findGroup({ direction: GroupDirection.LEFT }, rightGroup));
	});

	test('find neighbour group (up/down)', function () {
		const [part] = createPart();
		const rootGroup = part.activeGroup;
		const downGroup = part.addGroup(rootGroup, GroupDirection.DOWN);

		assert.strictEqual(downGroup, part.findGroup({ direction: GroupDirection.DOWN }, rootGroup));
		assert.strictEqual(rootGroup, part.findGroup({ direction: GroupDirection.UP }, downGroup));
	});

	test('find group by location (left/right)', function () {
		const [part] = createPart();
		const rootGroup = part.activeGroup;
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		const downGroup = part.addGroup(rightGroup, GroupDirection.DOWN);

		assert.strictEqual(rootGroup, part.findGroup({ location: GroupLocation.FIRST }));
		assert.strictEqual(downGroup, part.findGroup({ location: GroupLocation.LAST }));

		assert.strictEqual(rightGroup, part.findGroup({ location: GroupLocation.NEXT }, rootGroup));
		assert.strictEqual(rootGroup, part.findGroup({ location: GroupLocation.PREVIOUS }, rightGroup));

		assert.strictEqual(downGroup, part.findGroup({ location: GroupLocation.NEXT }, rightGroup));
		assert.strictEqual(rightGroup, part.findGroup({ location: GroupLocation.PREVIOUS }, downGroup));
	});

	test('applyLayout (2x2)', function () {
		const [part] = createPart();

		part.applyLayout({ groups: [{ groups: [{}, {}] }, { groups: [{}, {}] }], orientation: GroupOrientation.HORIZONTAL });

		assert.strictEqual(part.groups.length, 4);
	});

	test('centeredLayout', function () {
		const [part] = createPart();

		part.centerLayout(true);

		assert.strictEqual(part.isLayoutCentered(), true);
	});

	test('sticky editors', async () => {
		const [part] = createPart();
		const group = part.activeGroup;

		await part.whenRestored;

		assert.strictEqual(group.stickyCount, 0);
		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL).length, 0);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 0);
		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 0);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 0);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditor(input, EditorOptions.create({ pinned: true }));
		await group.openEditor(inputInactive, EditorOptions.create({ inactive: true }));

		assert.strictEqual(group.stickyCount, 0);
		assert.strictEqual(group.isSticky(input), false);
		assert.strictEqual(group.isSticky(inputInactive), false);

		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 2);

		group.stickEditor(input);

		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.isSticky(input), true);
		assert.strictEqual(group.isSticky(inputInactive), false);

		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 1);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 1);

		group.unstickEditor(input);

		assert.strictEqual(group.stickyCount, 0);
		assert.strictEqual(group.isSticky(input), false);
		assert.strictEqual(group.isSticky(inputInactive), false);

		assert.strictEqual(group.getIndexOfEditor(input), 0);
		assert.strictEqual(group.getIndexOfEditor(inputInactive), 1);

		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 2);

		let editorMoveCounter = 0;
		const editorGroupChangeListener = group.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.EDITOR_MOVE) {
				assert.ok(e.editor);
				editorMoveCounter++;
			}
		});

		group.stickEditor(inputInactive);

		assert.strictEqual(group.stickyCount, 1);
		assert.strictEqual(group.isSticky(input), false);
		assert.strictEqual(group.isSticky(inputInactive), true);

		assert.strictEqual(group.getIndexOfEditor(input), 1);
		assert.strictEqual(group.getIndexOfEditor(inputInactive), 0);
		assert.strictEqual(editorMoveCounter, 1);

		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 2);
		assert.strictEqual(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 1);
		assert.strictEqual(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 1);

		const inputSticky = new TestFileEditorInput(URI.file('foo/bar/sticky'), TEST_EDITOR_INPUT_ID);

		await group.openEditor(inputSticky, EditorOptions.create({ sticky: true }));

		assert.strictEqual(group.stickyCount, 2);
		assert.strictEqual(group.isSticky(input), false);
		assert.strictEqual(group.isSticky(inputInactive), true);
		assert.strictEqual(group.isSticky(inputSticky), true);

		assert.strictEqual(group.getIndexOfEditor(inputInactive), 0);
		assert.strictEqual(group.getIndexOfEditor(inputSticky), 1);
		assert.strictEqual(group.getIndexOfEditor(input), 2);

		await group.openEditor(input, EditorOptions.create({ sticky: true }));

		assert.strictEqual(group.stickyCount, 3);
		assert.strictEqual(group.isSticky(input), true);
		assert.strictEqual(group.isSticky(inputInactive), true);
		assert.strictEqual(group.isSticky(inputSticky), true);

		assert.strictEqual(group.getIndexOfEditor(inputInactive), 0);
		assert.strictEqual(group.getIndexOfEditor(inputSticky), 1);
		assert.strictEqual(group.getIndexOfEditor(input), 2);

		editorGroupChangeListener.dispose();
	});

	test('moveEditor with context (across groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);
		let firstOpenEditorContext: OpenEditorContext | undefined;
		Event.once(group.onWillOpenEditor)(e => {
			firstOpenEditorContext = e.context;
		});
		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		assert.strictEqual(firstOpenEditorContext, undefined);

		const waitForEditorWillOpen = new Promise<OpenEditorContext | undefined>(resolve => {
			Event.once(rightGroup.onWillOpenEditor)(e => resolve(e.context));
		});

		group.moveEditor(inputInactive, rightGroup, { index: 0 });
		const context = await waitForEditorWillOpen;
		assert.strictEqual(context, OpenEditorContext.MOVE_EDITOR);
	});

	test('copyEditor with context (across groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.strictEqual(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);
		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);
		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		const waitForEditorWillOpen = new Promise<OpenEditorContext | undefined>(resolve => {
			Event.once(rightGroup.onWillOpenEditor)(e => resolve(e.context));
		});

		group.copyEditor(inputInactive, rightGroup, { index: 0 });
		const context = await waitForEditorWillOpen;
		assert.strictEqual(context, OpenEditorContext.COPY_EDITOR);
	});
});
