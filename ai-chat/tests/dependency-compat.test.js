const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const nodemailer = require('nodemailer');
const Tunnel = require('localtunnel/lib/Tunnel');

test('upgraded nodemailer composes mail without contacting SMTP', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const result = await transport.sendMail({
    from: 'Shop <shop@example.com>',
    to: 'customer@example.com',
    subject: 'Compatibility check',
    text: 'Hello customer',
    inReplyTo: '<original@example.com>'
  });
  assert.deepEqual(result.envelope.to, ['customer@example.com']);
  assert.match(result.message.toString(), /Hello customer/);
  assert.match(result.message.toString(), /In-Reply-To: <original@example.com>/);
});

test('localtunnel negotiates metadata with overridden axios on localhost', { timeout: 5000 }, async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'demo', port: 1234, url: 'https://demo.example.com', max_conn_count: 1 }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const tunnel = new Tunnel({ host: `http://127.0.0.1:${server.address().port}`, subdomain: 'demo', port: 3000 });
  const info = await new Promise((resolve, reject) => {
    tunnel._init((error, value) => error ? reject(error) : resolve(value));
  });
  assert.deepEqual(requests, ['/demo']);
  assert.equal(info.name, 'demo');
  assert.equal(info.local_port, 3000);
  assert.equal(info.remote_port, 1234);
});
