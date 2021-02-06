/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { createRandomFile } from './utils';

export function timeoutAsync(n: number): Promise<void> {
	return new Promise(resolve => {
		setTimeout(() => {
			resolve();
		}, n);
	});
}

export function once<T>(event: vscode.Event<T>): vscode.Event<T> {
	return (listener: any, thisArgs = null, disposables?: any) => {
		// we need this, in case the event fires during the listener call
		let didFire = false;
		let result: vscode.Disposable;
		result = event(e => {
			if (didFire) {
				return;
			} else if (result) {
				result.dispose();
			} else {
				didFire = true;
			}

			return listener.call(thisArgs, e);
		}, null, disposables);

		if (didFire) {
			result.dispose();
		}

		return result;
	};
}

async function getEventOncePromise<T>(event: vscode.Event<T>): Promise<T> {
	return new Promise<T>((resolve, _reject) => {
		once(event)((result: T) => resolve(result));
	});
}

// Since `workbench.action.splitEditor` command does await properly
// Notebook editor/document events are not guaranteed to be sent to the ext host when promise resolves
// The workaround here is waiting for the first visible notebook editor change event.
async function splitEditor() {
	const once = getEventOncePromise(vscode.window.onDidChangeVisibleNotebookEditors);
	await vscode.commands.executeCommand('workbench.action.splitEditor');
	await once;
}

async function saveFileAndCloseAll(resource: vscode.Uri) {
	const documentClosed = new Promise<void>((resolve, _reject) => {
		const d = vscode.notebook.onDidCloseNotebookDocument(e => {
			if (e.uri.toString() === resource.toString()) {
				d.dispose();
				resolve();
			}
		});
	});
	await vscode.commands.executeCommand('workbench.action.files.save');
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	await documentClosed;
}

async function saveAllFilesAndCloseAll(resource: vscode.Uri | undefined) {
	const documentClosed = new Promise<void>((resolve, _reject) => {
		if (!resource) {
			return resolve();
		}
		const d = vscode.notebook.onDidCloseNotebookDocument(e => {
			if (e.uri.toString() === resource.toString()) {
				d.dispose();
				resolve();
			}
		});
	});
	await vscode.commands.executeCommand('workbench.action.files.saveAll');
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	await documentClosed;
}

function assertInitalState() {
	// no-op unless we figure out why some documents are opened after the editor is closed

	// assert.equal(vscode.window.activeNotebookEditor, undefined);
	// assert.equal(vscode.notebook.notebookDocuments.length, 0);
	// assert.equal(vscode.notebook.visibleNotebookEditors.length, 0);
}

suite('Notebook API tests', () => {
	// test.only('crash', async function () {
	// 	for (let i = 0; i < 200; i++) {
	// 		let resource = vscode.Uri.file(join(vscode.workspace.rootPath || '', './first.vsctestnb'));
	// 		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
	// 		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

	// 		resource = vscode.Uri.file(join(vscode.workspace.rootPath || '', './empty.vsctestnb'));
	// 		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
	// 		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	// 	}
	// });

	// test.only('crash', async function () {
	// 	for (let i = 0; i < 200; i++) {
	// 		let resource = vscode.Uri.file(join(vscode.workspace.rootPath || '', './first.vsctestnb'));
	// 		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
	// 		await vscode.commands.executeCommand('workbench.action.files.save');
	// 		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	// 		resource = vscode.Uri.file(join(vscode.workspace.rootPath || '', './empty.vsctestnb'));
	// 		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
	// 		await vscode.commands.executeCommand('workbench.action.files.save');
	// 		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	// 	}
	// });

	test('document open/close event', async function () {
		assertInitalState();

		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		const firstDocumentOpen = getEventOncePromise(vscode.notebook.onDidOpenNotebookDocument);
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await firstDocumentOpen;

		const firstDocumentClose = getEventOncePromise(vscode.notebook.onDidCloseNotebookDocument);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await firstDocumentClose;
	});

	test('notebook open/close, all cell-documents are ready', async function () {
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');

		const p = getEventOncePromise(vscode.notebook.onDidOpenNotebookDocument).then(notebook => {
			for (let cell of notebook.cells) {
				const doc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === cell.uri.toString());
				assert.ok(doc);
				assert.strictEqual(doc === cell.document, true);
				assert.strictEqual(doc?.languageId, cell.language);
				assert.strictEqual(doc?.isDirty, false);
				assert.strictEqual(doc?.isClosed, false);
			}
		});

		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await p;
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('notebook open/close, notebook ready when cell-document open event is fired', async function () {
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		let didHappen = false;
		const p = getEventOncePromise(vscode.workspace.onDidOpenTextDocument).then(doc => {
			if (doc.uri.scheme !== 'vscode-notebook-cell') {
				return;
			}
			const notebook = vscode.notebook.notebookDocuments.find(notebook => {
				const cell = notebook.cells.find(cell => cell.document === doc);
				return Boolean(cell);
			});
			assert.ok(notebook, `notebook for cell ${doc.uri} NOT found`);
			didHappen = true;
		});

		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await p;
		assert.strictEqual(didHappen, true);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('shared document in notebook editors', async function () {
		assertInitalState();

		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		let counter = 0;
		const disposables: vscode.Disposable[] = [];
		disposables.push(vscode.notebook.onDidOpenNotebookDocument(() => {
			counter++;
		}));
		disposables.push(vscode.notebook.onDidCloseNotebookDocument(() => {
			counter--;
		}));
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(counter, 1);

		await splitEditor();
		assert.equal(counter, 1);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		assert.equal(counter, 0);

		disposables.forEach(d => d.dispose());
	});

	test('editor open/close event', async function () {
		assertInitalState();

		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		const firstEditorOpen = getEventOncePromise(vscode.window.onDidChangeVisibleNotebookEditors);
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await firstEditorOpen;

		const firstEditorClose = getEventOncePromise(vscode.window.onDidChangeVisibleNotebookEditors);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await firstEditorClose;
	});

	test('editor open/close event 2', async function () {
		assertInitalState();

		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		let count = 0;
		const disposables: vscode.Disposable[] = [];
		disposables.push(vscode.window.onDidChangeVisibleNotebookEditors(() => {
			count = vscode.window.visibleNotebookEditors.length;
		}));

		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(count, 1);

		await splitEditor();
		assert.equal(count, 2);

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		assert.equal(count, 0);
	});

	test('editor editing event 2', async function () {
		assertInitalState();

		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const cellsChangeEvent = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		const cellChangeEventRet = await cellsChangeEvent;
		assert.equal(cellChangeEventRet.document, vscode.window.activeNotebookEditor?.document);
		assert.equal(cellChangeEventRet.changes.length, 1);
		assert.deepEqual(cellChangeEventRet.changes[0], {
			start: 1,
			deletedCount: 0,
			deletedItems: [],
			items: [
				vscode.window.activeNotebookEditor!.document.cells[1]
			]
		});

		const secondCell = vscode.window.activeNotebookEditor!.document.cells[1];

		const moveCellEvent = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);
		await vscode.commands.executeCommand('notebook.cell.moveUp');
		const moveCellEventRet = await moveCellEvent;
		assert.deepEqual(moveCellEventRet, {
			document: vscode.window.activeNotebookEditor!.document,
			changes: [
				{
					start: 1,
					deletedCount: 1,
					deletedItems: [secondCell],
					items: []
				},
				{
					start: 0,
					deletedCount: 0,
					deletedItems: [],
					items: [vscode.window.activeNotebookEditor?.document.cells[0]]
				}
			]
		});

		const cellOutputChange = getEventOncePromise<vscode.NotebookCellOutputsChangeEvent>(vscode.notebook.onDidChangeCellOutputs);
		await vscode.commands.executeCommand('notebook.cell.execute');
		const cellOutputsAddedRet = await cellOutputChange;
		assert.deepEqual(cellOutputsAddedRet, {
			document: vscode.window.activeNotebookEditor!.document,
			cells: [vscode.window.activeNotebookEditor!.document.cells[0]]
		});
		assert.equal(cellOutputsAddedRet.cells[0].outputs.length, 1);

		const cellOutputClear = getEventOncePromise<vscode.NotebookCellOutputsChangeEvent>(vscode.notebook.onDidChangeCellOutputs);
		await vscode.commands.executeCommand('notebook.cell.clearOutputs');
		const cellOutputsCleardRet = await cellOutputClear;
		assert.deepEqual(cellOutputsCleardRet, {
			document: vscode.window.activeNotebookEditor!.document,
			cells: [vscode.window.activeNotebookEditor!.document.cells[0]]
		});
		assert.equal(cellOutputsAddedRet.cells[0].outputs.length, 0);

		// const cellChangeLanguage = getEventOncePromise<vscode.NotebookCellLanguageChangeEvent>(vscode.notebook.onDidChangeCellLanguage);
		// await vscode.commands.executeCommand('notebook.cell.changeToMarkdown');
		// const cellChangeLanguageRet = await cellChangeLanguage;
		// assert.deepEqual(cellChangeLanguageRet, {
		// 	document: vscode.window.activeNotebookEditor!.document,
		// 	cells: vscode.window.activeNotebookEditor!.document.cells[0],
		// 	language: 'markdown'
		// });

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('editor move cell event', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
		await vscode.commands.executeCommand('notebook.focusTop');

		const activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 0);
		const moveChange = getEventOncePromise(vscode.notebook.onDidChangeNotebookCells);
		await vscode.commands.executeCommand('notebook.cell.moveDown');
		const ret = await moveChange;
		assert.deepEqual(ret, {
			document: vscode.window.activeNotebookEditor?.document,
			changes: [
				{
					start: 0,
					deletedCount: 1,
					deletedItems: [activeCell],
					items: []
				},
				{
					start: 1,
					deletedCount: 0,
					deletedItems: [],
					items: [activeCell]
				}
			]
		});

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		const firstEditor = vscode.window.activeNotebookEditor;
		assert.equal(firstEditor?.document.cells.length, 1);

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('notebook editor active/visible', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		const firstEditor = vscode.window.activeNotebookEditor;
		assert.strictEqual(firstEditor && vscode.window.visibleNotebookEditors.indexOf(firstEditor) >= 0, true);

		await splitEditor();
		const secondEditor = vscode.window.activeNotebookEditor;
		assert.strictEqual(secondEditor && vscode.window.visibleNotebookEditors.indexOf(secondEditor) >= 0, true);
		assert.notStrictEqual(firstEditor, secondEditor);
		assert.strictEqual(firstEditor && vscode.window.visibleNotebookEditors.indexOf(firstEditor) >= 0, true);
		assert.equal(vscode.window.visibleNotebookEditors.length, 2);

		const untitledEditorChange = getEventOncePromise(vscode.window.onDidChangeActiveNotebookEditor);
		await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
		await untitledEditorChange;
		assert.strictEqual(firstEditor && vscode.window.visibleNotebookEditors.indexOf(firstEditor) >= 0, true);
		assert.notStrictEqual(firstEditor, vscode.window.activeNotebookEditor);
		assert.strictEqual(secondEditor && vscode.window.visibleNotebookEditors.indexOf(secondEditor) < 0, true);
		assert.notStrictEqual(secondEditor, vscode.window.activeNotebookEditor);
		assert.equal(vscode.window.visibleNotebookEditors.length, 1);

		const activeEditorClose = getEventOncePromise(vscode.window.onDidChangeActiveNotebookEditor);
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		await activeEditorClose;
		assert.strictEqual(secondEditor, vscode.window.activeNotebookEditor);
		assert.equal(vscode.window.visibleNotebookEditors.length, 2);
		assert.strictEqual(secondEditor && vscode.window.visibleNotebookEditors.indexOf(secondEditor) >= 0, true);

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('notebook active editor change', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		const firstEditorOpen = getEventOncePromise(vscode.window.onDidChangeActiveNotebookEditor);
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await firstEditorOpen;

		const firstEditorDeactivate = getEventOncePromise(vscode.window.onDidChangeActiveNotebookEditor);
		await vscode.commands.executeCommand('workbench.action.splitEditor');
		await firstEditorDeactivate;

		await saveFileAndCloseAll(resource);
	});

	test('edit API (replaceCells)', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const cellsChangeEvent = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);
		await vscode.window.activeNotebookEditor!.edit(editBuilder => {
			editBuilder.replaceCells(1, 0, [{ cellKind: vscode.CellKind.Code, language: 'javascript', source: 'test 2', outputs: [], metadata: undefined }]);
		});

		const cellChangeEventRet = await cellsChangeEvent;
		assert.strictEqual(cellChangeEventRet.document === vscode.window.activeNotebookEditor?.document, true);
		assert.strictEqual(cellChangeEventRet.document.isDirty, true);
		assert.strictEqual(cellChangeEventRet.changes.length, 1);
		assert.strictEqual(cellChangeEventRet.changes[0].start, 1);
		assert.strictEqual(cellChangeEventRet.changes[0].deletedCount, 0);
		assert.strictEqual(cellChangeEventRet.changes[0].items[0] === vscode.window.activeNotebookEditor!.document.cells[1], true);

		await saveAllFilesAndCloseAll(resource);
	});

	test('edit API (replaceOutput, USE NotebookCellOutput-type)', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		await vscode.window.activeNotebookEditor!.edit(editBuilder => {
			editBuilder.replaceCellOutput(0, [new vscode.NotebookCellOutput([
				new vscode.NotebookCellOutputItem('application/foo', 'bar'),
				new vscode.NotebookCellOutputItem('application/json', { data: true }, { metadata: true }),
			])]);
		});

		const document = vscode.window.activeNotebookEditor?.document!;
		assert.strictEqual(document.isDirty, true);
		assert.strictEqual(document.cells.length, 1);
		assert.strictEqual(document.cells[0].outputs.length, 1);

		// consuming is OLD api (for now)
		const [output] = document.cells[0].outputs;

		assert.strictEqual(output.outputKind, vscode.CellOutputKind.Rich);
		assert.strictEqual((<vscode.CellDisplayOutput>output).data['application/foo'], 'bar');
		assert.deepStrictEqual((<vscode.CellDisplayOutput>output).data['application/json'], { data: true });
		assert.deepStrictEqual((<vscode.CellDisplayOutput>output).metadata, { custom: { 'application/json': { metadata: true } } });

		await saveAllFilesAndCloseAll(undefined);
	});

	test('edit API (replaceOutput)', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		await vscode.window.activeNotebookEditor!.edit(editBuilder => {
			editBuilder.replaceCellOutput(0, [{ outputKind: vscode.CellOutputKind.Rich, data: { foo: 'bar' } }]);
		});

		const document = vscode.window.activeNotebookEditor?.document!;
		assert.strictEqual(document.isDirty, true);
		assert.strictEqual(document.cells.length, 1);
		assert.strictEqual(document.cells[0].outputs.length, 1);
		assert.strictEqual(document.cells[0].outputs[0].outputKind, vscode.CellOutputKind.Rich);

		await saveAllFilesAndCloseAll(undefined);
	});

	test('edit API (replaceOutput, event)', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const outputChangeEvent = getEventOncePromise<vscode.NotebookCellOutputsChangeEvent>(vscode.notebook.onDidChangeCellOutputs);
		await vscode.window.activeNotebookEditor!.edit(editBuilder => {
			editBuilder.replaceCellOutput(0, [{ outputKind: vscode.CellOutputKind.Rich, data: { foo: 'bar' } }]);
		});

		const value = await outputChangeEvent;
		assert.strictEqual(value.document === vscode.window.activeNotebookEditor?.document, true);
		assert.strictEqual(value.document.isDirty, true);
		assert.strictEqual(value.cells.length, 1);
		assert.strictEqual(value.cells[0].outputs.length, 1);
		assert.strictEqual(value.cells[0].outputs[0].outputKind, vscode.CellOutputKind.Rich);

		await saveAllFilesAndCloseAll(undefined);
	});

	test('edit API (replaceMetadata)', async function () {

		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		await vscode.window.activeNotebookEditor!.edit(editBuilder => {
			editBuilder.replaceCellMetadata(0, { inputCollapsed: true, executionOrder: 17 });
		});

		const document = vscode.window.activeNotebookEditor?.document!;
		assert.strictEqual(document.cells.length, 1);
		assert.strictEqual(document.cells[0].metadata.executionOrder, 17);
		assert.strictEqual(document.cells[0].metadata.inputCollapsed, true);

		assert.strictEqual(document.isDirty, true);
		await saveFileAndCloseAll(resource);
	});

	test('edit API (replaceMetadata, event)', async function () {

		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const event = getEventOncePromise<vscode.NotebookCellMetadataChangeEvent>(vscode.notebook.onDidChangeCellMetadata);

		await vscode.window.activeNotebookEditor!.edit(editBuilder => {
			editBuilder.replaceCellMetadata(0, { inputCollapsed: true, executionOrder: 17 });
		});

		const data = await event;
		assert.strictEqual(data.document, vscode.window.activeNotebookEditor?.document);
		assert.strictEqual(data.cell.metadata.executionOrder, 17);
		assert.strictEqual(data.cell.metadata.inputCollapsed, true);

		assert.strictEqual(data.document.isDirty, true);
		await saveFileAndCloseAll(resource);
	});

	test('workspace edit API (replaceCells)', async function () {

		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const { document } = vscode.window.activeNotebookEditor!;
		assert.strictEqual(document.cells.length, 1);

		// inserting two new cells
		{
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCells(document.uri, 0, 0, [{
				cellKind: vscode.CellKind.Markdown,
				language: 'markdown',
				metadata: undefined,
				outputs: [],
				source: 'new_markdown'
			}, {
				cellKind: vscode.CellKind.Code,
				language: 'fooLang',
				metadata: undefined,
				outputs: [],
				source: 'new_code'
			}]);

			const success = await vscode.workspace.applyEdit(edit);
			assert.strictEqual(success, true);
		}

		assert.strictEqual(document.cells.length, 3);
		assert.strictEqual(document.cells[0].document.getText(), 'new_markdown');
		assert.strictEqual(document.cells[1].document.getText(), 'new_code');

		// deleting cell 1 and 3
		{
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCells(document.uri, 0, 1, []);
			edit.replaceNotebookCells(document.uri, 2, 3, []);
			const success = await vscode.workspace.applyEdit(edit);
			assert.strictEqual(success, true);
		}

		assert.strictEqual(document.cells.length, 1);
		assert.strictEqual(document.cells[0].document.getText(), 'new_code');

		// replacing all cells
		{
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCells(document.uri, 0, 1, [{
				cellKind: vscode.CellKind.Markdown,
				language: 'markdown',
				metadata: undefined,
				outputs: [],
				source: 'new2_markdown'
			}, {
				cellKind: vscode.CellKind.Code,
				language: 'fooLang',
				metadata: undefined,
				outputs: [],
				source: 'new2_code'
			}]);
			const success = await vscode.workspace.applyEdit(edit);
			assert.strictEqual(success, true);
		}
		assert.strictEqual(document.cells.length, 2);
		assert.strictEqual(document.cells[0].document.getText(), 'new2_markdown');
		assert.strictEqual(document.cells[1].document.getText(), 'new2_code');

		// remove all cells
		{
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCells(document.uri, 0, document.cells.length, []);
			const success = await vscode.workspace.applyEdit(edit);
			assert.strictEqual(success, true);
		}
		assert.strictEqual(document.cells.length, 0);

		await saveFileAndCloseAll(resource);
	});

	test('workspace edit API (replaceCells, event)', async function () {

		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const { document } = vscode.window.activeNotebookEditor!;
		assert.strictEqual(document.cells.length, 1);

		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookCells(document.uri, 0, 0, [{
			cellKind: vscode.CellKind.Markdown,
			language: 'markdown',
			metadata: undefined,
			outputs: [],
			source: 'new_markdown'
		}, {
			cellKind: vscode.CellKind.Code,
			language: 'fooLang',
			metadata: undefined,
			outputs: [],
			source: 'new_code'
		}]);

		const event = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);

		const success = await vscode.workspace.applyEdit(edit);
		assert.strictEqual(success, true);

		const data = await event;

		// check document
		assert.strictEqual(document.cells.length, 3);
		assert.strictEqual(document.cells[0].document.getText(), 'new_markdown');
		assert.strictEqual(document.cells[1].document.getText(), 'new_code');

		// check event data
		assert.strictEqual(data.document === document, true);
		assert.strictEqual(data.changes.length, 1);
		assert.strictEqual(data.changes[0].deletedCount, 0);
		assert.strictEqual(data.changes[0].deletedItems.length, 0);
		assert.strictEqual(data.changes[0].items.length, 2);
		assert.strictEqual(data.changes[0].items[0], document.cells[0]);
		assert.strictEqual(data.changes[0].items[1], document.cells[1]);
		await saveFileAndCloseAll(resource);
	});

	test('edit API batch edits', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const cellsChangeEvent = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);
		const cellMetadataChangeEvent = getEventOncePromise<vscode.NotebookCellMetadataChangeEvent>(vscode.notebook.onDidChangeCellMetadata);
		const version = vscode.window.activeNotebookEditor!.document.version;
		await vscode.window.activeNotebookEditor!.edit(editBuilder => {
			editBuilder.replaceCells(1, 0, [{ cellKind: vscode.CellKind.Code, language: 'javascript', source: 'test 2', outputs: [], metadata: undefined }]);
			editBuilder.replaceCellMetadata(0, { runnable: false });
		});

		await cellsChangeEvent;
		await cellMetadataChangeEvent;
		assert.strictEqual(version + 1, vscode.window.activeNotebookEditor!.document.version);
		await saveAllFilesAndCloseAll(resource);
	});

	test('edit API batch edits undo/redo', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const cellsChangeEvent = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);
		const cellMetadataChangeEvent = getEventOncePromise<vscode.NotebookCellMetadataChangeEvent>(vscode.notebook.onDidChangeCellMetadata);
		const version = vscode.window.activeNotebookEditor!.document.version;
		await vscode.window.activeNotebookEditor!.edit(editBuilder => {
			editBuilder.replaceCells(1, 0, [{ cellKind: vscode.CellKind.Code, language: 'javascript', source: 'test 2', outputs: [], metadata: undefined }]);
			editBuilder.replaceCellMetadata(0, { runnable: false });
		});

		await cellsChangeEvent;
		await cellMetadataChangeEvent;
		assert.strictEqual(vscode.window.activeNotebookEditor!.document.cells.length, 2);
		assert.strictEqual(vscode.window.activeNotebookEditor!.document.cells[0]?.metadata?.runnable, false);
		assert.strictEqual(version + 1, vscode.window.activeNotebookEditor!.document.version);

		await vscode.commands.executeCommand('undo');
		assert.strictEqual(version + 2, vscode.window.activeNotebookEditor!.document.version);
		assert.strictEqual(vscode.window.activeNotebookEditor!.document.cells[0]?.metadata?.runnable, undefined);
		assert.strictEqual(vscode.window.activeNotebookEditor!.document.cells.length, 1);

		await saveAllFilesAndCloseAll(resource);
	});

	test('initialzation should not emit cell change events.', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');

		let count = 0;
		const disposables: vscode.Disposable[] = [];
		disposables.push(vscode.notebook.onDidChangeNotebookCells(() => {
			count++;
		}));

		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(count, 0);

		disposables.forEach(d => d.dispose());

		await saveFileAndCloseAll(resource);
	});
});

suite('notebook workflow', () => {
	test('notebook open', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), 'test');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
		const activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.notEqual(vscode.window.activeNotebookEditor!.selection, undefined);
		assert.equal(activeCell!.document.getText(), '');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 3);
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 1);

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('notebook cell actions', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), 'test');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');

		// ---- insert cell below and focus ---- //
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

		// ---- insert cell above and focus ---- //
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
		let activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.notEqual(vscode.window.activeNotebookEditor!.selection, undefined);
		assert.equal(activeCell!.document.getText(), '');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 3);
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 1);

		// ---- focus bottom ---- //
		await vscode.commands.executeCommand('notebook.focusBottom');
		activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 2);

		// ---- focus top and then copy down ---- //
		await vscode.commands.executeCommand('notebook.focusTop');
		activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 0);

		await vscode.commands.executeCommand('notebook.cell.copyDown');
		activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 1);
		assert.equal(activeCell?.document.getText(), 'test');

		await vscode.commands.executeCommand('notebook.cell.delete');
		activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 1);
		assert.equal(activeCell?.document.getText(), '');

		// ---- focus top and then copy up ---- //
		await vscode.commands.executeCommand('notebook.focusTop');
		await vscode.commands.executeCommand('notebook.cell.copyUp');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 4);
		assert.equal(vscode.window.activeNotebookEditor!.document.cells[0].document.getText(), 'test');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells[1].document.getText(), 'test');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells[2].document.getText(), '');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells[3].document.getText(), '');
		activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 0);


		// ---- move up and down ---- //

		await vscode.commands.executeCommand('notebook.cell.moveDown');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(vscode.window.activeNotebookEditor!.selection!), 1,
			`first move down, active cell ${vscode.window.activeNotebookEditor!.selection!.uri.toString()}, ${vscode.window.activeNotebookEditor!.selection!.document.getText()}`);

		// await vscode.commands.executeCommand('notebook.cell.moveDown');
		// activeCell = vscode.window.activeNotebookEditor!.selection;

		// assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 2,
		// 	`second move down, active cell ${vscode.window.activeNotebookEditor!.selection!.uri.toString()}, ${vscode.window.activeNotebookEditor!.selection!.document.getText()}`);
		// assert.equal(vscode.window.activeNotebookEditor!.document.cells[0].document.getText(), 'test');
		// assert.equal(vscode.window.activeNotebookEditor!.document.cells[1].document.getText(), '');
		// assert.equal(vscode.window.activeNotebookEditor!.document.cells[2].document.getText(), 'test');
		// assert.equal(vscode.window.activeNotebookEditor!.document.cells[3].document.getText(), '');

		// ---- ---- //

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('notebook join cells', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), 'test');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');
		const edit = new vscode.WorkspaceEdit();
		edit.insert(vscode.window.activeNotebookEditor!.selection!.uri, new vscode.Position(0, 0), 'var abc = 0;');
		await vscode.workspace.applyEdit(edit);

		const cellsChangeEvent = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);
		await vscode.commands.executeCommand('notebook.cell.joinAbove');
		await cellsChangeEvent;

		assert.deepEqual(vscode.window.activeNotebookEditor!.selection?.document.getText().split(/\r\n|\r|\n/), ['test', 'var abc = 0;']);

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('move cells will not recreate cells in ExtHost', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
		await vscode.commands.executeCommand('notebook.focusTop');

		const activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 0);
		await vscode.commands.executeCommand('notebook.cell.moveDown');
		await vscode.commands.executeCommand('notebook.cell.moveDown');

		const newActiveCell = vscode.window.activeNotebookEditor!.selection;
		assert.deepEqual(activeCell, newActiveCell);

		await saveFileAndCloseAll(resource);
		// TODO@rebornix, there are still some events order issue.
		// assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(newActiveCell!), 2);
	});

	// test.only('document metadata is respected', async function () {
	// 	const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
	// 	await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

	// 	assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
	// 	const editor = vscode.window.activeNotebookEditor!;

	// 	assert.equal(editor.document.cells.length, 1);
	// 	editor.document.metadata.editable = false;
	// 	await editor.edit(builder => builder.delete(0));
	// 	assert.equal(editor.document.cells.length, 1, 'should not delete cell'); // Not editable, no effect
	// 	await editor.edit(builder => builder.insert(0, 'test', 'python', vscode.CellKind.Code, [], undefined));
	// 	assert.equal(editor.document.cells.length, 1, 'should not insert cell'); // Not editable, no effect

	// 	editor.document.metadata.editable = true;
	// 	await editor.edit(builder => builder.delete(0));
	// 	assert.equal(editor.document.cells.length, 0, 'should delete cell'); // Editable, it worked
	// 	await editor.edit(builder => builder.insert(0, 'test', 'python', vscode.CellKind.Code, [], undefined));
	// 	assert.equal(editor.document.cells.length, 1, 'should insert cell'); // Editable, it worked

	// 	// await vscode.commands.executeCommand('workbench.action.files.save');
	// 	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	// });

	test('cell runnable metadata is respected', async () => {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		const editor = vscode.window.activeNotebookEditor!;

		await vscode.commands.executeCommand('notebook.focusTop');
		const cell = editor.document.cells[0];
		assert.equal(cell.outputs.length, 0);

		let metadataChangeEvent = getEventOncePromise<vscode.NotebookCellMetadataChangeEvent>(vscode.notebook.onDidChangeCellMetadata);
		cell.metadata.runnable = false;
		await metadataChangeEvent;

		await vscode.commands.executeCommand('notebook.cell.execute');
		assert.equal(cell.outputs.length, 0, 'should not execute'); // not runnable, didn't work

		metadataChangeEvent = getEventOncePromise<vscode.NotebookCellMetadataChangeEvent>(vscode.notebook.onDidChangeCellMetadata);
		cell.metadata.runnable = true;
		await metadataChangeEvent;

		await vscode.commands.executeCommand('notebook.cell.execute');
		assert.equal(cell.outputs.length, 1, 'should execute'); // runnable, it worked

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('document runnable metadata is respected', async () => {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		const editor = vscode.window.activeNotebookEditor!;

		const cell = editor.document.cells[0];
		assert.equal(cell.outputs.length, 0);
		let metadataChangeEvent = getEventOncePromise<vscode.NotebookDocumentMetadataChangeEvent>(vscode.notebook.onDidChangeNotebookDocumentMetadata);
		editor.document.metadata.runnable = false;
		await metadataChangeEvent;

		await vscode.commands.executeCommand('notebook.execute');
		assert.equal(cell.outputs.length, 0, 'should not execute'); // not runnable, didn't work

		metadataChangeEvent = getEventOncePromise<vscode.NotebookDocumentMetadataChangeEvent>(vscode.notebook.onDidChangeNotebookDocumentMetadata);
		editor.document.metadata.runnable = true;
		await metadataChangeEvent;

		await vscode.commands.executeCommand('notebook.execute');
		assert.equal(cell.outputs.length, 1, 'should execute'); // runnable, it worked

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('cell execute command takes arguments', async () => {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		const editor = vscode.window.activeNotebookEditor!;
		const cell = editor.document.cells[0];

		await vscode.commands.executeCommand('notebook.execute');
		assert.equal(cell.outputs.length, 0, 'should not execute'); // not runnable, didn't work

		const metadataChangeEvent = getEventOncePromise<vscode.NotebookDocumentMetadataChangeEvent>(vscode.notebook.onDidChangeNotebookDocumentMetadata);
		editor.document.metadata.runnable = true;
		await metadataChangeEvent;

		await vscode.commands.executeCommand('notebook.execute');
		assert.equal(cell.outputs.length, 1, 'should execute'); // runnable, it worked

		const clearChangeEvent = getEventOncePromise<vscode.NotebookDocumentMetadataChangeEvent>(vscode.notebook.onDidChangeCellOutputs);
		await vscode.commands.executeCommand('notebook.cell.clearOutputs');
		await clearChangeEvent;
		assert.equal(cell.outputs.length, 0, 'should clear');

		const secondResource = await createRandomFile('', undefined, 'second', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', secondResource, 'notebookCoreTest');
		await vscode.commands.executeCommand('notebook.cell.execute', { start: 0, end: 1 }, resource);
		assert.equal(cell.outputs.length, 1, 'should execute'); // runnable, it worked
		assert.equal(vscode.window.activeNotebookEditor?.document.uri.fsPath, secondResource.fsPath);

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('document execute command takes arguments', async () => {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		const editor = vscode.window.activeNotebookEditor!;
		const cell = editor.document.cells[0];

		await vscode.commands.executeCommand('notebook.execute');
		assert.equal(cell.outputs.length, 0, 'should not execute'); // not runnable, didn't work

		const metadataChangeEvent = getEventOncePromise<vscode.NotebookDocumentMetadataChangeEvent>(vscode.notebook.onDidChangeNotebookDocumentMetadata);
		editor.document.metadata.runnable = true;
		await metadataChangeEvent;

		await vscode.commands.executeCommand('notebook.execute');
		assert.equal(cell.outputs.length, 1, 'should execute'); // runnable, it worked

		const clearChangeEvent = getEventOncePromise<vscode.NotebookDocumentMetadataChangeEvent>(vscode.notebook.onDidChangeCellOutputs);
		await vscode.commands.executeCommand('notebook.cell.clearOutputs');
		await clearChangeEvent;
		assert.equal(cell.outputs.length, 0, 'should clear');

		const secondResource = await createRandomFile('', undefined, 'second', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', secondResource, 'notebookCoreTest');
		await vscode.commands.executeCommand('notebook.execute', resource);
		assert.equal(cell.outputs.length, 1, 'should execute'); // runnable, it worked
		assert.equal(vscode.window.activeNotebookEditor?.document.uri.fsPath, secondResource.fsPath);

		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('cell execute and select kernel', async () => {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		const editor = vscode.window.activeNotebookEditor!;
		const cell = editor.document.cells[0];

		const metadataChangeEvent = getEventOncePromise<vscode.NotebookDocumentMetadataChangeEvent>(vscode.notebook.onDidChangeNotebookDocumentMetadata);
		editor.document.metadata.runnable = true;
		await metadataChangeEvent;

		await vscode.commands.executeCommand('notebook.cell.execute');
		assert.equal(cell.outputs.length, 1, 'should execute'); // runnable, it worked
		assert.deepEqual((cell.outputs[0] as vscode.CellDisplayOutput).data, {
			'text/plain': [
				'my output'
			]
		});

		await vscode.commands.executeCommand('notebook.selectKernel', { extension: 'vscode.vscode-notebook-tests', id: 'secondaryKernel' })
		await vscode.commands.executeCommand('notebook.cell.execute');
		assert.equal(cell.outputs.length, 1, 'should execute'); // runnable, it worked
		assert.deepEqual((cell.outputs[0] as vscode.CellDisplayOutput).data, {
			'text/plain': [
				'my second output'
			]
		});
		await vscode.commands.executeCommand('workbench.action.files.save');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});
});

suite('notebook dirty state', () => {
	test('notebook open', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), 'test');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
		const activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.notEqual(vscode.window.activeNotebookEditor!.selection, undefined);
		assert.equal(activeCell!.document.getText(), '');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 3);
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 1);

		const edit = new vscode.WorkspaceEdit();
		edit.insert(activeCell!.uri, new vscode.Position(0, 0), 'var abc = 0;');
		await vscode.workspace.applyEdit(edit);
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true);
		assert.equal(vscode.window.activeNotebookEditor?.selection !== undefined, true);
		assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells[1], vscode.window.activeNotebookEditor?.selection);
		assert.equal(vscode.window.activeNotebookEditor?.selection?.document.getText(), 'var abc = 0;');

		await saveFileAndCloseAll(resource);
	});
});

suite('notebook undo redo', () => {
	test('notebook open', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), 'test');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
		const activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.notEqual(vscode.window.activeNotebookEditor!.selection, undefined);
		assert.equal(activeCell!.document.getText(), '');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 3);
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 1);


		// modify the second cell, delete it
		const edit = new vscode.WorkspaceEdit();
		edit.insert(vscode.window.activeNotebookEditor!.selection!.uri, new vscode.Position(0, 0), 'var abc = 0;');
		await vscode.workspace.applyEdit(edit);
		await vscode.commands.executeCommand('notebook.cell.delete');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 2);
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(vscode.window.activeNotebookEditor!.selection!), 1);


		// undo should bring back the deleted cell, and revert to previous content and selection
		await vscode.commands.executeCommand('undo');
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 3);
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(vscode.window.activeNotebookEditor!.selection!), 1);
		assert.equal(vscode.window.activeNotebookEditor?.selection?.document.getText(), 'var abc = 0;');

		// redo
		// await vscode.commands.executeCommand('notebook.redo');
		// assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 2);
		// assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(vscode.window.activeNotebookEditor!.selection!), 1);
		// assert.equal(vscode.window.activeNotebookEditor?.selection?.document.getText(), 'test');

		await saveFileAndCloseAll(resource);
	});

	test.skip('execute and then undo redo', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const cellsChangeEvent = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		const cellChangeEventRet = await cellsChangeEvent;
		assert.equal(cellChangeEventRet.document, vscode.window.activeNotebookEditor?.document);
		assert.equal(cellChangeEventRet.changes.length, 1);
		assert.deepEqual(cellChangeEventRet.changes[0], {
			start: 1,
			deletedCount: 0,
			deletedItems: [],
			items: [
				vscode.window.activeNotebookEditor!.document.cells[1]
			]
		});

		const secondCell = vscode.window.activeNotebookEditor!.document.cells[1];

		const moveCellEvent = getEventOncePromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);
		await vscode.commands.executeCommand('notebook.cell.moveUp');
		const moveCellEventRet = await moveCellEvent;
		assert.deepEqual(moveCellEventRet, {
			document: vscode.window.activeNotebookEditor!.document,
			changes: [
				{
					start: 1,
					deletedCount: 1,
					deletedItems: [secondCell],
					items: []
				},
				{
					start: 0,
					deletedCount: 0,
					deletedItems: [],
					items: [vscode.window.activeNotebookEditor?.document.cells[0]]
				}
			]
		});

		const cellOutputChange = getEventOncePromise<vscode.NotebookCellOutputsChangeEvent>(vscode.notebook.onDidChangeCellOutputs);
		await vscode.commands.executeCommand('notebook.cell.execute');
		const cellOutputsAddedRet = await cellOutputChange;
		assert.deepEqual(cellOutputsAddedRet, {
			document: vscode.window.activeNotebookEditor!.document,
			cells: [vscode.window.activeNotebookEditor!.document.cells[0]]
		});
		assert.equal(cellOutputsAddedRet.cells[0].outputs.length, 1);

		const cellOutputClear = getEventOncePromise<vscode.NotebookCellOutputsChangeEvent>(vscode.notebook.onDidChangeCellOutputs);
		await vscode.commands.executeCommand('undo');
		const cellOutputsCleardRet = await cellOutputClear;
		assert.deepEqual(cellOutputsCleardRet, {
			document: vscode.window.activeNotebookEditor!.document,
			cells: [vscode.window.activeNotebookEditor!.document.cells[0]]
		});
		assert.equal(cellOutputsAddedRet.cells[0].outputs.length, 0);

		await saveFileAndCloseAll(resource);
	});

});

suite('notebook working copy', () => {
	// test('notebook revert on close', async function () {
	// 	const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
	// 	await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
	// 	await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
	// 	assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

	// 	await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
	// 	await vscode.commands.executeCommand('default:type', { text: 'var abc = 0;' });

	// 	// close active editor from command will revert the file
	// 	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	// 	await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
	// 	assert.equal(vscode.window.activeNotebookEditor !== undefined, true);
	// 	assert.equal(vscode.window.activeNotebookEditor?.selection !== undefined, true);
	// 	assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells[0], vscode.window.activeNotebookEditor?.selection);
	// 	assert.equal(vscode.window.activeNotebookEditor?.selection?.document.getText(), 'test');

	// 	await vscode.commands.executeCommand('workbench.action.files.save');
	// 	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	// });

	// test('notebook revert', async function () {
	// 	const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
	// 	await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
	// 	await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
	// 	assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

	// 	await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
	// 	await vscode.commands.executeCommand('default:type', { text: 'var abc = 0;' });
	// 	await vscode.commands.executeCommand('workbench.action.files.revert');

	// 	assert.equal(vscode.window.activeNotebookEditor !== undefined, true);
	// 	assert.equal(vscode.window.activeNotebookEditor?.selection !== undefined, true);
	// 	assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells[0], vscode.window.activeNotebookEditor?.selection);
	// 	assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells.length, 1);
	// 	assert.equal(vscode.window.activeNotebookEditor?.selection?.document.getText(), 'test');

	// 	await vscode.commands.executeCommand('workbench.action.files.saveAll');
	// 	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	// });

	test('multiple tabs: dirty + clean', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
		const edit = new vscode.WorkspaceEdit();
		edit.insert(vscode.window.activeNotebookEditor!.selection!.uri, new vscode.Position(0, 0), 'var abc = 0;');
		await vscode.workspace.applyEdit(edit);

		const secondResource = await createRandomFile('', undefined, 'second', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', secondResource, 'notebookCoreTest');
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

		// make sure that the previous dirty editor is still restored in the extension host and no data loss
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true);
		assert.equal(vscode.window.activeNotebookEditor?.selection !== undefined, true);
		assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells[1], vscode.window.activeNotebookEditor?.selection);
		assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells.length, 3);
		assert.equal(vscode.window.activeNotebookEditor?.selection?.document.getText(), 'var abc = 0;');

		await saveFileAndCloseAll(resource);
	});

	test('multiple tabs: two dirty tabs and switching', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

		await vscode.commands.executeCommand('notebook.cell.insertCodeCellAbove');
		const edit = new vscode.WorkspaceEdit();
		edit.insert(vscode.window.activeNotebookEditor!.selection!.uri, new vscode.Position(0, 0), 'var abc = 0;');
		await vscode.workspace.applyEdit(edit);

		const secondResource = await createRandomFile('', undefined, 'second', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', secondResource, 'notebookCoreTest');
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');

		// switch to the first editor
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true);
		assert.equal(vscode.window.activeNotebookEditor?.selection !== undefined, true);
		assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells[1], vscode.window.activeNotebookEditor?.selection);
		assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells.length, 3);
		assert.equal(vscode.window.activeNotebookEditor?.selection?.document.getText(), 'var abc = 0;');

		// switch to the second editor
		await vscode.commands.executeCommand('vscode.openWith', secondResource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true);
		assert.equal(vscode.window.activeNotebookEditor?.selection !== undefined, true);
		assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells[1], vscode.window.activeNotebookEditor?.selection);
		assert.deepEqual(vscode.window.activeNotebookEditor?.document.cells.length, 2);
		assert.equal(vscode.window.activeNotebookEditor?.selection?.document.getText(), '');

		await saveAllFilesAndCloseAll(secondResource);
		// await vscode.commands.executeCommand('workbench.action.files.saveAll');
		// await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('multiple tabs: different editors with same document', async function () {
		assertInitalState();

		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		const firstNotebookEditor = vscode.window.activeNotebookEditor;
		assert.equal(firstNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(firstNotebookEditor!.selection?.document.getText(), 'test');
		assert.equal(firstNotebookEditor!.selection?.language, 'typescript');

		await splitEditor();
		const secondNotebookEditor = vscode.window.activeNotebookEditor;
		assert.equal(secondNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(secondNotebookEditor!.selection?.document.getText(), 'test');
		assert.equal(secondNotebookEditor!.selection?.language, 'typescript');

		assert.notEqual(firstNotebookEditor, secondNotebookEditor);
		assert.equal(firstNotebookEditor?.document, secondNotebookEditor?.document, 'split notebook editors share the same document');
		// assert.notEqual(firstNotebookEditor?.asWebviewUri(vscode.Uri.file('./hello.png')), secondNotebookEditor?.asWebviewUri(vscode.Uri.file('./hello.png')));

		await saveAllFilesAndCloseAll(resource);

		// await vscode.commands.executeCommand('workbench.action.files.saveAll');
		// await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
});

suite('metadata', () => {
	test('custom metadata should be supported', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(vscode.window.activeNotebookEditor!.document.metadata.custom!['testMetadata'] as boolean, false);
		assert.equal(vscode.window.activeNotebookEditor!.selection?.metadata.custom!['testCellMetadata'] as number, 123);
		assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');

		await saveFileAndCloseAll(resource);
	});


	// TODO@rebornix skip as it crashes the process all the time
	test.skip('custom metadata should be supported 2', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(vscode.window.activeNotebookEditor!.document.metadata.custom!['testMetadata'] as boolean, false);
		assert.equal(vscode.window.activeNotebookEditor!.selection?.metadata.custom!['testCellMetadata'] as number, 123);
		assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');

		// TODO see #101462
		// await vscode.commands.executeCommand('notebook.cell.copyDown');
		// const activeCell = vscode.window.activeNotebookEditor!.selection;
		// assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 1);
		// assert.equal(activeCell?.metadata.custom!['testCellMetadata'] as number, 123);

		await saveFileAndCloseAll(resource);
	});
});

suite('regression', () => {
	// test('microsoft/vscode-github-issue-notebooks#26. Insert template cell in the new empty document', async function () {
	// 	assertInitalState();
	// 	await vscode.commands.executeCommand('workbench.action.files.newUntitledFile', { "viewType": "notebookCoreTest" });
	// 	assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
	// 	assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), '');
	// 	assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');
	// 	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	// });

	test('#106657. Opening a notebook from markers view is broken ', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const document = vscode.window.activeNotebookEditor?.document!;
		const [cell] = document.cells;

		await saveAllFilesAndCloseAll(document.uri);
		assert.strictEqual(vscode.window.activeNotebookEditor, undefined);

		// opening a cell-uri opens a notebook editor
		await vscode.commands.executeCommand('vscode.open', cell.uri, vscode.ViewColumn.Active);

		assert.strictEqual(!!vscode.window.activeNotebookEditor, true);
		assert.strictEqual(vscode.window.activeNotebookEditor!.document.uri.toString(), resource.toString());
	});

	test.skip('Cannot open notebook from cell-uri with vscode.open-command', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		const document = vscode.window.activeNotebookEditor?.document!;
		const [cell] = document.cells;

		await saveAllFilesAndCloseAll(document.uri);
		assert.strictEqual(vscode.window.activeNotebookEditor, undefined);

		// BUG is that the editor opener (https://github.com/microsoft/vscode/blob/8e7877bdc442f1e83a7fec51920d82b696139129/src/vs/editor/browser/services/openerService.ts#L69)
		// removes the fragment if it matches something numeric. For notebooks that's not wanted...
		await vscode.commands.executeCommand('vscode.open', cell.uri);

		assert.strictEqual(vscode.window.activeNotebookEditor!.document.uri.toString(), resource.toString());
	});

	test('#97830, #97764. Support switch to other editor types', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'empty', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		await vscode.commands.executeCommand('notebook.cell.insertCodeCellBelow');
		const edit = new vscode.WorkspaceEdit();
		edit.insert(vscode.window.activeNotebookEditor!.selection!.uri, new vscode.Position(0, 0), 'var abc = 0;');
		await vscode.workspace.applyEdit(edit);

		assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.document.getText(), 'var abc = 0;');
		assert.equal(vscode.window.activeNotebookEditor!.selection?.language, 'typescript');

		await vscode.commands.executeCommand('vscode.openWith', resource, 'default');
		assert.equal(vscode.window.activeTextEditor?.document.uri.path, resource.path);

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	// open text editor, pin, and then open a notebook
	test('#96105 - dirty editors', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'empty', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'default');
		const edit = new vscode.WorkspaceEdit();
		edit.insert(resource, new vscode.Position(0, 0), 'var abc = 0;');
		await vscode.workspace.applyEdit(edit);

		// now it's dirty, open the resource with notebook editor should open a new one
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
		assert.notEqual(vscode.window.activeNotebookEditor, undefined, 'notebook first');
		// assert.notEqual(vscode.window.activeTextEditor, undefined);

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('#102411 - untitled notebook creation failed', async function () {
		assertInitalState();
		await vscode.commands.executeCommand('workbench.action.files.newUntitledFile', { viewType: 'notebookCoreTest' });
		assert.notEqual(vscode.window.activeNotebookEditor, undefined, 'untitled notebook editor is not undefined');

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('#102423 - copy/paste shares the same text buffer', async function () {
		assertInitalState();
		const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
		await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

		let activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(activeCell?.document.getText(), 'test');

		await vscode.commands.executeCommand('notebook.cell.copyDown');
		await vscode.commands.executeCommand('notebook.cell.edit');
		activeCell = vscode.window.activeNotebookEditor!.selection;
		assert.equal(vscode.window.activeNotebookEditor!.document.cells.indexOf(activeCell!), 1);
		assert.equal(activeCell?.document.getText(), 'test');

		const edit = new vscode.WorkspaceEdit();
		edit.insert(vscode.window.activeNotebookEditor!.selection!.uri, new vscode.Position(0, 0), 'var abc = 0;');
		await vscode.workspace.applyEdit(edit);

		assert.equal(vscode.window.activeNotebookEditor!.document.cells.length, 2);
		assert.notEqual(vscode.window.activeNotebookEditor!.document.cells[0].document.getText(), vscode.window.activeNotebookEditor!.document.cells[1].document.getText());

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
});

suite('webview', () => {
	// for web, `asWebUri` gets `https`?
	// test('asWebviewUri', async function () {
	// 	if (vscode.env.uiKind === vscode.UIKind.Web) {
	// 		return;
	// 	}

	// 	const resource = await createRandomFile('', undefined, 'first', '.vsctestnb');
	// 	await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');
	// 	assert.equal(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
	// 	const uri = vscode.window.activeNotebookEditor!.asWebviewUri(vscode.Uri.file('./hello.png'));
	// 	assert.equal(uri.scheme, 'vscode-webview-resource');
	// 	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	// });


	// 404 on web
	// test('custom renderer message', async function () {
	// 	if (vscode.env.uiKind === vscode.UIKind.Web) {
	// 		return;
	// 	}

	// 	const resource = vscode.Uri.file(join(vscode.workspace.rootPath || '', './customRenderer.vsctestnb'));
	// 	await vscode.commands.executeCommand('vscode.openWith', resource, 'notebookCoreTest');

	// 	const editor = vscode.window.activeNotebookEditor;
	// 	const promise = new Promise(resolve => {
	// 		const messageEmitter = editor?.onDidReceiveMessage(e => {
	// 			if (e.type === 'custom_renderer_initialize') {
	// 				resolve();
	// 				messageEmitter?.dispose();
	// 			}
	// 		});
	// 	});

	// 	await vscode.commands.executeCommand('notebook.cell.execute');
	// 	await promise;
	// 	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	// });
});
