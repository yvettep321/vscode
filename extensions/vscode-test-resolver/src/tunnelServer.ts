/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';

try {
	const remotePort = parseInt(process.argv[2]);
	const localPort = parseInt(process.argv[3]);
	const parentPID = parseInt(process.argv[4]);

	const proxyServer = net.createServer(proxySocket => {
		const remoteSocket = net.createConnection({ host: 'localhost', port: remotePort });
		remoteSocket.pipe(proxySocket);
		proxySocket.pipe(remoteSocket);
	});
	proxyServer.listen(localPort, () => {
		const localPort = (<net.AddressInfo>proxyServer.address()).port;
		console.log(`New test resolver tunnel service: Remote ${remotePort} -> local ${localPort}`);
	});

	// close when the parent process is closed
	let timer = setInterval(function () {
		try {
			process.kill(parentPID, 0); // throws an exception if the process doesn't exist anymore.
		} catch (e) {
			// the local customer does not exist anymore
			clearInterval(timer);
			proxyServer.close();
		}
	}, 1000);
} catch (e) {
	console.log(e);
}




