import net from 'net';
import tls from 'tls';
import dgram from 'dgram';


/**
 * Connects to a TCP server, sends a message, and returns the response data as a Promise<string>.
 * @param host - The TCP server host.
 * @param port - The TCP server port.
 * @param message - The message to send.
 * @returns Promise<string> - The response data from the server.
 */
export function sendTcpRequest(host: string, port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let result = '';

    client.connect(port, host, () => {
      client.write(message);
    });

    client.on('data', (data) => {
      result += data.toString();
      client.end();
    });

    client.on('close', () => {
      resolve(result);
    });

    client.on('error', (err) => {
      reject(err);
    });
  });
}


/**
 * Sends a UDP message to the specified host and port, and returns the response as a string.
 *
 * @param host - The target UDP server hostname or IP address.
 * @param port - The destination port on the remote UDP server (i.e. the port you're sending the message to).
 * @param message - The message to send, as a string.
 * @param options - Optional configuration object.
 * @param options.expectResponse - Whether to expect a response (default: true).
 * @param options.sourcePort - The local port to send the message from (i.e. the port used on your side).
 * @param options.timeout - Timeout in ms (default: 1000 if no response expected, 5000 if response expected).
 * @returns Promise<string> - Resolves with the response message, or rejects if an error occurs.
 */
export function sendUdpRequest(
  host: string, 
  port: number, 
  message: string, 
  options: {
    expectResponse?: boolean;
    sourcePort?: number;
    timeout?: number;
  } = {}
): Promise<string> {
  const { expectResponse = true, sourcePort, timeout = expectResponse ? 3000 : 1000 } = options;

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const buffer = Buffer.from(message);

    let finished = false;
    const cleanup = () => {
      if (!finished) {
        finished = true;
        socket.close();
        clearTimeout(timeoutId);
      }
    };

    // Set timeout
    const timeoutId = setTimeout(() => {
      cleanup();
      // If no response is expected, consider timeout as success
      if (!expectResponse) {
        console.log('No response expected, packet was sent successfully');
        resolve('');
      } else {
        reject(new Error('UDP request timed out'));
      }
    }, timeout);

    // Only set message handler if response is expected
    if (expectResponse) {
      socket.on('message', (msg) => {
        cleanup();
        resolve(msg.toString());
      });
    }

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });

    // Bind to specified source port if provided
    if (sourcePort) {
      console.log(`Binding to source port ${sourcePort}, host ${host}, port ${port}`);
      socket.bind(sourcePort, () => {
        socket.send(buffer, port, host, (err) => {
          if (err) {
            cleanup();
            return reject(err);
          }
        });
      });
    } else {
      // No source port specified, send directly
      socket.send(buffer, port, host, (err) => {
        if (err) {
          cleanup();
          return reject(err);
        }
      });
    }
  });
}


/**
 * Establishes a TLS connection to the specified host and port, sends a payload, and returns the response.
 *
 * @param host - The target server hostname or IP address.
 * @param port - The destination port on the remote server (i.e. the port you're connecting to).
 * @param payload - The data to send after the TLS handshake, as a string or Buffer.
 * @param servername - Optional SNI server name for TLS handshake. If not provided, SNI will not be used.
 * @param options - Optional additional TLS connection options (e.g., cert, key, ca).
 * @param sourcePort - Optional local port to use for the connection (i.e. the port used on your side).
 * @returns A Promise that resolves to the response string received from the server, or rejects on error.
 *
 * @throws Will reject the promise if the TLS handshake fails, the connection times out,
 *         or the socket is closed prematurely.
 */
export async function sendTlsRequest(
  host: string,
  port: number,
  payload: Buffer | string,
  servername?: string, // Make servername optional
  options: tls.ConnectionOptions = {},
  sourcePort?: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let isHandled = false;
    let handshakeCompleted = false;
    let response = '';

    console.log(`Connecting to TLS server at ${host}:${port} with${servername ? '' : 'out'} servername, source port ${sourcePort}`);

    // Step 1: Create TCP connection
    const socket = net.connect({
      host,
      port,
      localPort: sourcePort,
    }, () => {
      // Step 2: Upgrade to TLS
      const tlsOptions: tls.ConnectionOptions = {
        socket,
        rejectUnauthorized: false,
        ...options,
      };

      if (servername) {
        tlsOptions.servername = servername; // only set if provided
      }

      const tlsSocket = tls.connect(tlsOptions, () => {
        handshakeCompleted = true;
        console.log('TLS handshake completed');
        tlsSocket.write(payload);
      });

      tlsSocket.setTimeout(5000);

      tlsSocket.on('data', (chunk) => {
        response += chunk.toString('utf8');
      });

      tlsSocket.on('end', () => {
        if (handshakeCompleted && !isHandled) {
          isHandled = true;
          resolve(response);
        }
      });

      tlsSocket.on('close', (hadError) => {
        if (!handshakeCompleted && !isHandled) {
          isHandled = true;
          reject(new Error('TLS socket closed before handshake completed'));
        } else if (handshakeCompleted && !isHandled) {
          isHandled = true;
          hadError ? reject(new Error('TLS socket closed due to an error')) : resolve(response);
        }
      });

      tlsSocket.on('error', (err) => {
        if (!isHandled) {
          isHandled = true;
          reject(err);
        }
      });

      tlsSocket.on('timeout', () => {
        if (!isHandled) {
          isHandled = true;
          tlsSocket.destroy();
          reject(new Error('TLS timeout'));
        }
      });
    });

    socket.on('error', (err) => {
      if (!isHandled) {
        isHandled = true;
        reject(err);
      }
    });
  });
}
