/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { FileStorageDatabase } from 'vs/platform/storage/browser/storageService';
import { join } from 'vs/base/common/path';
import { tmpdir } from 'os';
import { rimraf } from 'vs/base/node/pfs';
import { NullLogService } from 'vs/platform/log/common/log';
import { Storage } from 'vs/base/parts/storage/common/storage';
import { URI } from 'vs/base/common/uri';
import { FileService } from 'vs/platform/files/common/fileService';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';

suite('Storage', () => {

	let testDir: string;

	let fileService: FileService;
	let fileProvider: DiskFileSystemProvider;

	const disposables = new DisposableStore();

	setup(async () => {
		const logService = new NullLogService();

		fileService = disposables.add(new FileService(logService));

		fileProvider = disposables.add(new DiskFileSystemProvider(logService));
		disposables.add(fileService.registerProvider(Schemas.file, fileProvider));

		testDir = getRandomTestPath(tmpdir(), 'vsctests', 'storageservice');
	});

	teardown(() => {
		disposables.clear();

		return rimraf(testDir);
	});

	test('File Based Storage', async () => {
		let storage = new Storage(new FileStorageDatabase(URI.file(join(testDir, 'storage.json')), false, fileService));

		await storage.init();

		storage.set('bar', 'foo');
		storage.set('barNumber', 55);
		storage.set('barBoolean', true);

		strictEqual(storage.get('bar'), 'foo');
		strictEqual(storage.get('barNumber'), '55');
		strictEqual(storage.get('barBoolean'), 'true');

		await storage.close();

		storage = new Storage(new FileStorageDatabase(URI.file(join(testDir, 'storage.json')), false, fileService));

		await storage.init();

		strictEqual(storage.get('bar'), 'foo');
		strictEqual(storage.get('barNumber'), '55');
		strictEqual(storage.get('barBoolean'), 'true');

		storage.delete('bar');
		storage.delete('barNumber');
		storage.delete('barBoolean');

		strictEqual(storage.get('bar', 'undefined'), 'undefined');
		strictEqual(storage.get('barNumber', 'undefinedNumber'), 'undefinedNumber');
		strictEqual(storage.get('barBoolean', 'undefinedBoolean'), 'undefinedBoolean');

		await storage.close();

		storage = new Storage(new FileStorageDatabase(URI.file(join(testDir, 'storage.json')), false, fileService));

		await storage.init();

		strictEqual(storage.get('bar', 'undefined'), 'undefined');
		strictEqual(storage.get('barNumber', 'undefinedNumber'), 'undefinedNumber');
		strictEqual(storage.get('barBoolean', 'undefinedBoolean'), 'undefinedBoolean');
	});
});
