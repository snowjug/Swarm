/**
 * A PostgreSQL server for the driver tests, and for nothing else: PGlite behind the PostgreSQL wire
 * protocol, so that the real `pg` client can be exercised without installing a database. It runs in
 * a process of its own because the code under test blocks its own thread while it waits for a reply.
 * Prints `LISTENING <port>` once it accepts connections.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const database = await PGlite.create();
const server = new PGLiteSocketServer({ db: database, port: 0, host: '127.0.0.1' });
await server.start();
const port = server.getServerConn().split(':').pop();
console.log(`LISTENING ${port}`);

const stop = () => void server.stop().then(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
