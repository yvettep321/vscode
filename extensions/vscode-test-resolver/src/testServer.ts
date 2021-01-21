/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';

try {
	const port = parseInt(process.argv[2]);
	const parentPID = parseInt(process.argv[3]);

	const server = http.createServer((_req, res) => {
		res.writeHead(200);
		res.end(`Hello, World from test server running on port ${port}!`);
	});
	server.listen(port);
	console.log(`Started HTTP server on http://localhost:${port}.`);

	// close when the parent process is closed
	let timer = setInterval(function () {
		try {
			process.kill(parentPID, 0); // throws an exception if the process doesn't exist anymore.
		} catch (e) {
			// the local customer does not exist anymore
			clearInterval(timer);
			server.close();
		}
	}, 1000);
} catch (e) {
	console.log(e);
}




