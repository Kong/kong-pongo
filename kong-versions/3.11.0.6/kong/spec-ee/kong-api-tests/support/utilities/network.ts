
import net from 'net';
import tls from 'tls';
import dns from 'dns';
import { execFile } from 'child_process';

/**
 * parse url target string into host, port, sni
 * @param urlString - e.g. "localhost:8100" or "https://host:8443"
 * @returns 
 *  "https://api.example.com" => { host: "api.example.com", port: 443, sni: "api.example.com" }
 *  "localhost:8100" => { host: "localhost", port: 8100, sni: "localhost" }
 *   ipv4 supports only
 */
const parseUrl = (urlString: string) => {
  if (urlString.includes('://')) {
    const u = new URL(urlString);
    return { host: u.hostname, port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80), sni: u.hostname };
  }
  if (urlString.startsWith('[')) throw new Error('IPv6 literal not supported (IPv4-only).');
  const i = urlString.lastIndexOf(':');
  if (i > -1 && urlString.indexOf(':') === i) {
    const host = urlString.slice(0, i);
    const port = Number(urlString.slice(i + 1));
    if (!Number.isFinite(port) || port <= 0) throw new Error('Invalid port');
    return { host, port, sni: host };
  }
  return { host: urlString, port: 443, sni: urlString };
}

/**
 * Test whether TLS works (handshake succeeds) over IPv4.
 * Prints: "host:port TLS OK (IPv4), ALPN=..." or "host:port TLS FAILED (...)".
 * @param {string} target e.g. "localhost:8100" or "https://host:8443"
 * @param {number} timeoutMs default 3000
 * @returns {Promise<boolean>}
 */
export async function checkTlsEnabled(target, timeoutMs = 3000) {
  let host, port, sni;
  try { ({ host, port, sni } = parseUrl(target)); }
  catch (e: any) { 
    const msg = (e instanceof Error) ? e.message : String(e);
    console.log(`[ERROR] ${msg}`); 
    return false; 
  }

  // Resolve one IPv4 address (A record). If input is already IPv4, use it.
  let ip = host;
  const fam = net.isIP(host);
  if (fam === 6) { console.log(`[connect] ${host}:${port} TLS DISABLED (no IPv4 address)`); return false; }
  if (fam === 0) {
    try {
      ip = await new Promise((res, rej) =>
        dns.lookup(host, { family: 4 }, (err, addr) => err ? rej(err) : res(addr))
      );
    } catch {
      console.log(`[connect] ${host}:${port} TLS DISABLED (DNS error)`);
      return false;
    }
  }

  // Single TLS attempt
  const result = await new Promise<{ ok: boolean; alpn?: string | null; err?: string }>((resolve) => {
    let finished = false;
    let sock;
    const done = (ok, info) => {
      if (finished) return;
      finished = true;
      try { sock?.end(); } catch { /** ignore */ }
      try { sock?.destroy(); } catch { /** ignore */}
      resolve({ ok, ...info });
    };
    try {
      sock = tls.connect({
        host: ip,
        port,
        servername: sni,
        rejectUnauthorized: false,        // allow self-signed
        ALPNProtocols: ['h2', 'http/1.1'],
      });
    } catch (e) {
      return done(false, { err: (e instanceof Error && e.message) ? e.message : String(e) });
    }
    sock.setTimeout(timeoutMs, () => done(false, { err: 'ETIMEDOUT' }));
    sock.once('secureConnect', () => done(true, { alpn: sock.alpnProtocol || null }));
    sock.once('error', (e) => done(false, { err: e?.code || e?.message || 'TLS_ERROR' }));
  });

  if (result.ok) {
    console.log(`[connect] ${host}:${port} TLS ENABLED (IPv4)${result.alpn ? `, ALPN=${result.alpn}` : ''}`);
    return true;
  } else {
    console.log(`[connect] ${host}:${port} TLS DISABLED (${result.err})`);
    return false;
  }
}


/**
 * Return true if TCP connect to "host:port" succeeds within timeout.
 * @param {string} target - e.g. "localhost:8100"
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<boolean>}
 */
export async function isTcpOpen(target, timeoutMs = 3000) {
  const i = target.lastIndexOf(':');
  if (i <= 0) return false;

  const host = target.slice(0, i).trim();
  const port = Number(target.slice(i + 1));
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return false;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error',  () => finish(false));
    socket.connect({ host, port, family: 4 });
  });
}

/**
 * Get the IP address of a Docker container.
 * @param name 
 * @returns 
 */
export async function getContainerIP(
  name: string
): Promise<string | null> {
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    execFile(
      "docker",
      ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", name],
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve({ stdout });
      }
    );
  });
  const ip = stdout.trim();
  return ip ? ip : null;
}