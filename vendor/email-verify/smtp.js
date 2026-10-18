import { randomBytes } from 'node:crypto';
import net from 'node:net';

const HELO_NAME = 'verify.local';

/**
 * HELO, MAIL FROM, RCPT TO, QUIT. No DATA command, so no message is sent.
 * After a determinate recipient reply, a second RCPT TO for a random
 * local-part runs on this same connection. A 2xx pair is the catch-all
 * check. A 5xx pair that matches is a blanket rejection, not proof the
 * mailbox is absent.
 *
 * On Apify (and any cloud host that blocks outbound port 25), pass
 * `proxyUrl` / `getProxyUrl` so the TCP session is opened with HTTP
 * CONNECT through a residential proxy. Direct dials remain for local
 * tests and injected fixtures.
 *
 * @param {{
 *   hosts: string[],
 *   email: string,
 *   domain: string,
 *   timeoutMs: number,
 *   checkCatchAll: boolean,
 *   port?: number,
 *   proxyUrl?: string | null,
 *   getProxyUrl?: () => string | Promise<string | null | undefined>,
 * }} options
 * @returns {Promise<{ outcome: 'accepted' | 'rejected' | 'temporary' | 'unreachable', timedOut: boolean, catchAll: boolean, blanketReject: boolean }>}
 */
export async function probeMailbox({
    hosts,
    email,
    domain,
    timeoutMs,
    checkCatchAll,
    port = 25,
    proxyUrl = null,
    getProxyUrl,
}) {
    const list = Array.isArray(hosts) ? hosts.filter((host) => typeof host === 'string' && host.length > 0) : [];
    if (list.length === 0) return { outcome: 'unreachable', timedOut: false, catchAll: false, blanketReject: false };

    const deadline = Date.now() + timeoutMs;
    let sawTimeout = false;
    for (const host of list) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { outcome: 'unreachable', timedOut: true, catchAll: false, blanketReject: false };
        try {
            const resolvedProxy = getProxyUrl ? await getProxyUrl() : proxyUrl;
            return await probeHost({
                host,
                port,
                email,
                domain,
                timeoutMs: remaining,
                checkCatchAll,
                proxyUrl: resolvedProxy || null,
            });
        } catch (error) {
            if (isTimeout(error)) sawTimeout = true;
        }
    }
    return { outcome: 'unreachable', timedOut: sawTimeout, catchAll: false, blanketReject: false };
}

/**
 * @param {{
 *   host: string,
 *   port: number,
 *   email: string,
 *   domain: string,
 *   timeoutMs: number,
 *   checkCatchAll: boolean,
 *   proxyUrl?: string | null,
 * }} options
 */
async function probeHost({ host, port, email, domain, timeoutMs, checkCatchAll, proxyUrl = null }) {
    const deadline = Date.now() + timeoutMs;
    const socket = await connect(host, port, Math.max(1, deadline - Date.now()), proxyUrl);
    const session = new SmtpSession(socket, deadline, socket.smtpPreamble || '');
    try {
        const greeting = await session.readReply();
        const greetingStop = classifyHandshake(greeting.code);
        if (greetingStop) return greetingStop;

        session.send(`HELO ${HELO_NAME}`);
        const helo = await session.readReply();
        const heloStop = classifyHandshake(helo.code);
        if (heloStop) return heloStop;

        session.send('MAIL FROM:<>');
        const mailFrom = await session.readReply();
        const mailStop = classifyHandshake(mailFrom.code);
        if (mailStop) return mailStop;

        session.send(`RCPT TO:<${email}>`);
        const rcpt = await session.readReply();
        const outcome = classifyRcpt(rcpt.code);
        if (outcome === 'accepted' && checkCatchAll) {
            return interpretCatchAll(await readRandomRcpt(session, domain));
        }
        if (outcome === 'rejected') {
            const probe = await readRandomRcpt(session, domain);
            const blanketReject = Boolean(probe) && repliesLookUniform(rcpt, probe);
            return { outcome, timedOut: false, catchAll: false, blanketReject };
        }
        return { outcome, timedOut: false, catchAll: false, blanketReject: false };
    } finally {
        await session.quit();
    }
}

/**
 * Second RCPT TO on the connection already open. Null when that follow-up
 * cannot be completed; the caller keeps the first recipient's verdict.
 * @param {SmtpSession} session
 * @param {string} domain
 * @returns {Promise<{ code: number, lines: string[] } | null>}
 */
async function readRandomRcpt(session, domain) {
    try {
        session.send('RSET');
        const reset = await session.readReply();
        if (reset.code < 200 || reset.code >= 300) return null;

        session.send('MAIL FROM:<>');
        const mailFrom = await session.readReply();
        if (mailFrom.code < 200 || mailFrom.code >= 300) return null;

        const local = `no-such-mailbox-${randomBytes(12).toString('hex')}`;
        session.send(`RCPT TO:<${local}@${domain}>`);
        return await session.readReply();
    } catch {
        return null;
    }
}

/**
 * @param {{ code: number, lines: string[] } | null} rcpt
 */
function interpretCatchAll(rcpt) {
    if (!rcpt) return { outcome: 'unreachable', timedOut: false, catchAll: false, blanketReject: false };
    if (rcpt.code >= 200 && rcpt.code < 300) {
        return { outcome: 'accepted', timedOut: false, catchAll: true, blanketReject: false };
    }
    if (rcpt.code >= 400 && rcpt.code < 500) {
        return { outcome: 'temporary', timedOut: false, catchAll: false, blanketReject: false };
    }
    if (rcpt.code >= 500 && rcpt.code < 600) {
        return { outcome: 'accepted', timedOut: false, catchAll: false, blanketReject: false };
    }
    return { outcome: 'unreachable', timedOut: false, catchAll: false, blanketReject: false };
}

/**
 * True when two 5xx replies would not let a verifier tell the recipients apart.
 * The recipient address is removed first, because servers echo it inside an
 * otherwise identical rejection.
 * @param {{ code: number, lines?: string[] }} real
 * @param {{ code: number, lines?: string[] }} probe
 */
export function repliesLookUniform(real, probe) {
    if (!real || !probe || real.code !== probe.code) return false;
    if (real.code < 500 || real.code >= 600) return false;
    const left = normalizeReply(real.lines);
    const right = normalizeReply(probe.lines);
    if (left === right) return true;
    const scale = Math.max(left.length, right.length);
    if (scale < 12) return false;
    return 1 - levenshtein(left, right) / scale >= 0.85;
}

/**
 * @param {string[] | undefined} lines
 */
function normalizeReply(lines) {
    return (lines ?? [])
        .map((line) => line.replace(/^[0-9]{3}(?:[ -][0-9]\.[0-9]\.[0-9])?/, ''))
        .join(' ')
        .toLowerCase()
        .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * @param {string} left
 * @param {string} right
 */
function levenshtein(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        let diagonal = previous[0];
        previous[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const insert = previous[j] + 1;
            const remove = previous[j - 1] + 1;
            const replace = diagonal + (left[i - 1] === right[j - 1] ? 0 : 1);
            diagonal = previous[j];
            previous[j] = Math.min(insert, remove, replace);
        }
    }
    return previous[right.length];
}

/**
 * @param {number} code
 * @returns {{ outcome: 'temporary' | 'unreachable', timedOut: false, catchAll: false } | null}
 */
function classifyHandshake(code) {
    if (code >= 200 && code < 300) return null;
    if (code >= 400 && code < 500) {
        return { outcome: 'temporary', timedOut: false, catchAll: false, blanketReject: false };
    }
    return { outcome: 'unreachable', timedOut: false, catchAll: false, blanketReject: false };
}

/**
 * @param {number} code
 * @returns {'accepted' | 'rejected' | 'temporary' | 'unreachable'}
 */
function classifyRcpt(code) {
    if (code >= 200 && code < 300) return 'accepted';
    if (code >= 400 && code < 500) return 'temporary';
    if (code >= 500 && code < 600) return 'rejected';
    return 'unreachable';
}

/**
 * Open a TCP socket to host:port, optionally tunneled through an HTTP
 * CONNECT proxy (Apify Proxy uses this for residential / datacenter).
 * When a proxy is used, the returned socket may already contain the start
 * of the SMTP banner in `smtpPreamble` (string) so callers must seed the
 * session buffer before reading.
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @param {string | null} [proxyUrl]
 * @returns {Promise<import('node:net').Socket & { smtpPreamble?: string }>}
 */
export function connect(host, port, timeoutMs, proxyUrl = null) {
    if (proxyUrl) return connectViaHttpProxy(proxyUrl, host, port, timeoutMs);
    return connectDirect(host, port, timeoutMs);
}

/**
 * Timed reachability probe used to confirm direct vs proxied port 25.
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @param {string | null} [proxyUrl]
 * @returns {Promise<{ ok: boolean, timedOut: boolean, ms: number, error?: string }>}
 */
export async function probeTcpReachable(host, port, timeoutMs, proxyUrl = null) {
    const started = Date.now();
    try {
        const socket = await connect(host, port, timeoutMs, proxyUrl);
        socket.destroy();
        return { ok: true, timedOut: false, ms: Date.now() - started };
    } catch (error) {
        const err = /** @type {Error & { code?: string, proxyStatus?: number }} */ (error);
        return {
            ok: false,
            timedOut: isTimeout(err),
            ms: Date.now() - started,
            error: err.code || err.message,
            proxyStatus: err.proxyStatus,
            message: err.message,
        };
    }
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<import('node:net').Socket>}
 */
function connectDirect(host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(Object.assign(new Error('SMTP connection timed out'), { code: 'ETIMEOUT' }));
        }, timeoutMs);
        const fail = (error) => {
            clearTimeout(timer);
            socket.destroy();
            reject(error);
        };
        socket.once('error', fail);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.removeListener('error', fail);
            resolve(socket);
        });
    });
}

/**
 * HTTP CONNECT tunnel. After a 200 response the socket is the raw TCP
 * channel to the target — suitable for SMTP on port 25.
 * @param {string} proxyUrl
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<import('node:net').Socket>}
 */
function connectViaHttpProxy(proxyUrl, host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        let proxy;
        try {
            proxy = new URL(proxyUrl);
        } catch {
            reject(Object.assign(new Error('Invalid SMTP proxy URL'), { code: 'EPROXY' }));
            return;
        }
        if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') {
            reject(Object.assign(new Error('SMTP proxy must be an http(s) CONNECT proxy'), { code: 'EPROXY' }));
            return;
        }

        const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);
        const socket = net.connect({ host: proxy.hostname, port: proxyPort });
        let settled = false;
        /** @type {Buffer[]} */
        const chunks = [];
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;

        const fail = (error) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            socket.destroy();
            reject(error);
        };

        timer = setTimeout(() => {
            fail(Object.assign(new Error('SMTP connection timed out'), { code: 'ETIMEOUT' }));
        }, timeoutMs);

        socket.once('error', fail);
        socket.once('connect', () => {
            const lines = [
                `CONNECT ${host}:${port} HTTP/1.1`,
                `Host: ${host}:${port}`,
            ];
            if (proxy.username || proxy.password) {
                const token = Buffer.from(
                    `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
                    'utf8',
                ).toString('base64');
                lines.push(`Proxy-Authorization: Basic ${token}`);
            }
            lines.push('Connection: keep-alive', '', '');
            socket.write(lines.join('\r\n'));
        });

        socket.on('data', (chunk) => {
            if (settled) return;
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const buffer = Buffer.concat(chunks);
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;
            const header = buffer.slice(0, headerEnd).toString('utf8');
            const match = header.match(/^HTTP\/\d\.\d\s+(\d+)/i);
            const status = match ? Number(match[1]) : 0;
            if (status !== 200) {
                fail(Object.assign(
                    new Error(`SMTP proxy CONNECT failed with HTTP ${status || 'unknown'}`),
                    {
                        code: status === 407 ? 'EPROXYAUTH' : 'EPROXY',
                        proxyStatus: status || 0,
                    },
                ));
                return;
            }
            settled = true;
            clearTimeout(timer);
            socket.removeAllListeners('data');
            socket.removeAllListeners('error');
            // Bytes after the CONNECT headers are the start of the SMTP banner.
            const leftover = buffer.slice(headerEnd + 4).toString('latin1');
            /** @type {import('node:net').Socket & { smtpPreamble?: string }} */
            const tunneled = socket;
            tunneled.smtpPreamble = leftover;
            // Hold further data until SmtpSession attaches its listener.
            socket.pause();
            socket.on('error', () => {});
            resolve(tunneled);
            // Resume on next tick so the session constructor can subscribe first.
            setImmediate(() => {
                if (!socket.destroyed) socket.resume();
            });
        });
    });
}

class SmtpSession {
    /**
     * @param {import('node:net').Socket} socket
     * @param {number} deadline
     * @param {string} [preamble]
     */
    constructor(socket, deadline, preamble = '') {
        this.socket = socket;
        this.deadline = deadline;
        this.buffer = preamble || '';
        this.pending = null;
        this.closed = false;
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            this.buffer += chunk;
            this.flush();
        });
        socket.on('error', (error) => this.fail(error));
        socket.on('close', () => {
            this.fail(Object.assign(new Error('SMTP connection closed'), { code: 'ECONNRESET' }));
        });
    }

    /**
     * @param {string} line
     */
    send(line) {
        this.socket.write(`${line}\r\n`);
    }

    readReply() {
        const ready = this.extractReply();
        if (ready) return Promise.resolve(ready);
        if (this.closed) {
            return Promise.reject(Object.assign(new Error('SMTP connection closed'), { code: 'ECONNRESET' }));
        }
        const remaining = this.deadline - Date.now();
        if (remaining <= 0) {
            return Promise.reject(Object.assign(new Error('SMTP connection timed out'), { code: 'ETIMEOUT' }));
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending = null;
                this.socket.destroy();
                reject(Object.assign(new Error('SMTP connection timed out'), { code: 'ETIMEOUT' }));
            }, remaining);
            this.pending = {
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            };
            const late = this.extractReply();
            if (late && this.pending) {
                const pending = this.pending;
                this.pending = null;
                pending.resolve(late);
            }
        });
    }

    flush() {
        if (!this.pending) return;
        const reply = this.extractReply();
        if (!reply) return;
        const pending = this.pending;
        this.pending = null;
        pending.resolve(reply);
    }

    extractReply() {
        const lines = [];
        while (this.buffer.includes('\n')) {
            const newline = this.buffer.indexOf('\n');
            let line = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            lines.push(line);
            if (line.length >= 4 && line[3] === '-') continue;
            const code = Number.parseInt(line.slice(0, 3), 10);
            return { code: Number.isFinite(code) ? code : 0, lines };
        }
        return null;
    }

    /**
     * @param {Error & { code?: string }} error
     */
    fail(error) {
        if (this.closed) return;
        this.closed = true;
        if (!this.pending) return;
        const pending = this.pending;
        this.pending = null;
        pending.reject(error);
    }

    async quit() {
        if (this.closed || this.socket.destroyed) {
            this.socket.destroy();
            return;
        }
        this.closed = true;
        try {
            this.send('QUIT');
        } catch {
            this.socket.destroy();
            return;
        }
        await new Promise((resolve) => {
            const timer = setTimeout(resolve, Math.min(500, Math.max(0, this.deadline - Date.now())));
            this.socket.once('data', () => {
                clearTimeout(timer);
                resolve(undefined);
            });
            this.socket.once('close', () => {
                clearTimeout(timer);
                resolve(undefined);
            });
            this.socket.once('error', () => {
                clearTimeout(timer);
                resolve(undefined);
            });
        });
        this.socket.destroy();
    }
}

/**
 * @param {unknown} error
 */
function isTimeout(error) {
    return Boolean(error && typeof error === 'object' && (error.code === 'ETIMEOUT' || error.code === 'ETIMEDOUT'));
}
