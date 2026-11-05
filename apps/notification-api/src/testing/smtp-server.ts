import { createServer, type AddressInfo, type Socket } from 'node:net';

/** A plain-text SMTP server on 127.0.0.1 that accepts every message and never offers STARTTLS. */
export interface TestSmtpServer {
  readonly port: number;
  /** Every command line received, in order (DATA content excluded). */
  readonly commands: string[];
  /** The raw content of each accepted message. */
  readonly messages: string[];
  /** While true, every MAIL FROM gets a temporary 451 and no message is accepted. */
  failing: boolean;
  close(): Promise<void>;
}

function handleSession(socket: Socket, server: Pick<TestSmtpServer, 'commands' | 'messages' | 'failing'>): void {
  const { commands, messages } = server;
  let buffer = '';
  let data: string[] | null = null;
  const reply = (line: string) => socket.write(`${line}\r\n`);
  reply('220 test-smtp ESMTP');
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let end = buffer.indexOf('\r\n');
    while (end !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\r\n');
      if (data) {
        if (line === '.') {
          messages.push(data.join('\r\n'));
          data = null;
          reply('250 2.0.0 queued');
        } else data.push(line);
        continue;
      }
      commands.push(line);
      const verb = line.split(' ')[0]?.toUpperCase();
      if (verb === 'EHLO') reply('250-test-smtp\r\n250 8BITMIME');
      else if (verb === 'STARTTLS') reply('502 5.5.1 STARTTLS not supported');
      else if (verb === 'MAIL' && server.failing) reply('451 4.3.0 try again later');
      else if (verb === 'DATA') {
        data = [];
        reply('354 end with .');
      } else if (verb === 'QUIT') {
        reply('221 bye');
        socket.end();
      } else reply('250 OK');
    }
  });
}

export async function startTestSmtpServer(): Promise<TestSmtpServer> {
  const session = { commands: [] as string[], messages: [] as string[], failing: false };
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handleSession(socket, session);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a TCP server listening on a port.
  const { port } = server.address() as AddressInfo;
  return Object.assign(session, {
    port,
    close: (): Promise<void> =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  });
}
