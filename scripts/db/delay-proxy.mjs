// Forwards TCP to a server with a delay added in each direction, so that a database a few
// milliseconds (or a few hundred) away can be measured on one machine. It runs as a process of its own
// because the application's PostgreSQL bridge blocks its thread while it waits for an answer: a proxy
// in that thread could never forward it.
//
//   node scripts/db/delay-proxy.mjs <target host> <target port> <delay in ms, each way>
//
// Prints `LISTENING <port>` when it accepts connections on 127.0.0.1. Nothing it forwards is read.
import net from 'node:net';

const [host, port, delay] = process.argv.slice(2);
const oneWay = Number(delay);
if (!host || !Number(port) || !Number.isFinite(oneWay) || oneWay < 0) {
  console.error('usage: delay-proxy.mjs <host> <port> <one-way delay in ms>');
  process.exit(2);
}

// Chunks wait the same time, so they leave in the order they came.
const forward = (from, to) => {
  from.on('data', (chunk) => {
    setTimeout(() => {
      if (!to.destroyed) to.write(chunk);
    }, oneWay);
  });
  from.on('end', () => setTimeout(() => to.end(), oneWay));
  from.on('error', () => to.destroy());
};

const server = net.createServer((client) => {
  const upstream = net.connect(Number(port), host);
  client.setNoDelay(true);
  upstream.setNoDelay(true);
  forward(client, upstream);
  forward(upstream, client);
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
});
server.listen(0, '127.0.0.1', () => {
  console.log(`LISTENING ${server.address().port}`);
});
const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
