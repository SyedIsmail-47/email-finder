import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { connect, probeMailbox, probeTcpReachable } from '../vendor/email-verify/smtp.js';

/**
 * Minimal HTTP CONNECT proxy that opens a real TCP tunnel to the target.
 * @returns {Promise<{ proxyUrl: string, close: () => Promise<void> }>}
 */
function startConnectProxy() {
    return new Promise((resolve) => {
        const server = net.createServer((client) => {
            let buf = Buffer.alloc(0);
            const onData = (chunk) => {
                buf = Buffer.concat([buf, chunk]);
                const headerEnd = buf.indexOf('\r\n\r\n');
                if (headerEnd === -1) return;
                client.removeListener('data', onData);
                const header = buf.slice(0, headerEnd).toString('utf8');
                const requestLine = header.split('\r\n')[0] || '';
                const match = requestLine.match(/^CONNECT\s+([^:\s]+):(\d+)\s+/i);
                if (!match) {
                    client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
                    return;
                }
                const host = match[1];
                const port = Number(match[2]);
                const head = buf.slice(headerEnd + 4);
                const upstream = net.connect({ host, port }, () => {
                    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    if (head.length) upstream.write(head);
                    upstream.pipe(client);
                    client.pipe(upstream);
                });
                upstream.on('error', () => client.destroy());
                client.on('error', () => upstream.destroy());
            };
            client.on('data', onData);
        });
        server.listen(0, '127.0.0.1', () => {
            const address = /** @type {import('node:net').AddressInfo} */ (server.address());
            resolve({
                proxyUrl: `http://127.0.0.1:${address.port}`,
                close: () => new Promise((done) => server.close(() => done())),
            });
        });
    });
}

/**
 * Fake SMTP that accepts one RCPT and rejects the catch-all probe.
 * @returns {Promise<{ host: string, port: number, close: () => Promise<void> }>}
 */
function startFakeSmtp() {
    return new Promise((resolve) => {
        /** @type {import('node:net').Socket[]} */
        const sockets = [];
        const server = net.createServer((socket) => {
            sockets.push(socket);
            let buffer = '';
            let rcptCount = 0;
            socket.write('220 test.local ESMTP\r\n');
            socket.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
                while (buffer.includes('\r\n')) {
                    const line = buffer.slice(0, buffer.indexOf('\r\n'));
                    buffer = buffer.slice(buffer.indexOf('\r\n') + 2);
                    const upper = line.toUpperCase();
                    if (upper.startsWith('HELO') || upper.startsWith('EHLO') || upper.startsWith('MAIL')) {
                        socket.write('250 OK\r\n');
                    } else if (upper.startsWith('RCPT')) {
                        rcptCount += 1;
                        socket.write(rcptCount === 1 ? '250 OK\r\n' : '550 No such user\r\n');
                    } else if (upper.startsWith('RSET')) {
                        socket.write('250 OK\r\n');
                    } else if (upper.startsWith('QUIT')) {
                        socket.write('221 Bye\r\n');
                        socket.end();
                    } else {
                        socket.write('250 OK\r\n');
                    }
                }
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const address = /** @type {import('node:net').AddressInfo} */ (server.address());
            resolve({
                host: '127.0.0.1',
                port: address.port,
                close: () => new Promise((done) => {
                    for (const socket of sockets) socket.destroy();
                    server.close(() => done());
                }),
            });
        });
    });
}

test('HTTP CONNECT proxy can open a TCP tunnel used by SMTP probe', async () => {
    const smtp = await startFakeSmtp();
    const proxy = await startConnectProxy();
    try {
        const reachable = await probeTcpReachable(smtp.host, smtp.port, 2_000, proxy.proxyUrl);
        assert.equal(reachable.ok, true);

        const socket = await connect(smtp.host, smtp.port, 2_000, proxy.proxyUrl);
        socket.destroy();

        const result = await probeMailbox({
            hosts: [smtp.host],
            email: 'person@example.com',
            domain: 'example.com',
            timeoutMs: 3_000,
            checkCatchAll: true,
            port: smtp.port,
            proxyUrl: proxy.proxyUrl,
        });
        assert.equal(result.outcome, 'accepted');
        assert.equal(result.catchAll, false);
    } finally {
        await proxy.close();
        await smtp.close();
    }
});
