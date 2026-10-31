import { describe, expect, it } from 'vitest';
import { UrlFailure } from '../src/ingest/url/failure.js';
import { classifyAddress, MAX_URL_LENGTH, validateUrl } from '../src/ingest/url/policy.js';

const blocked = (address: string, reason?: string) => {
  const verdict = classifyAddress(address);
  expect(verdict.allowed, address).toBe(false);
  if (reason && !verdict.allowed) expect(verdict.reason, address).toBe(reason);
};
const allowed = (address: string) => expect(classifyAddress(address).allowed, address).toBe(true);

const failure = (run: () => unknown): UrlFailure => {
  try {
    run();
  } catch (error) {
    if (error instanceof UrlFailure) return error;
    throw error;
  }
  throw new Error('The address was accepted.');
};

describe('the address policy: IPv4', () => {
  // [first address of the range, last address, why]
  const ranges: [string, string, string][] = [
    ['0.0.0.0', '0.255.255.255', 'unspecified'],
    ['10.0.0.0', '10.255.255.255', 'private-network'],
    ['100.64.0.0', '100.127.255.255', 'shared-address-space'],
    ['127.0.0.0', '127.255.255.255', 'loopback'],
    ['169.254.0.0', '169.254.255.255', 'link-local'],
    ['172.16.0.0', '172.31.255.255', 'private-network'],
    ['192.0.0.0', '192.0.0.255', 'protocol-assignment'],
    ['192.0.2.0', '192.0.2.255', 'documentation'],
    ['192.168.0.0', '192.168.255.255', 'private-network'],
    ['198.18.0.0', '198.19.255.255', 'benchmarking'],
    ['198.51.100.0', '198.51.100.255', 'documentation'],
    ['203.0.113.0', '203.0.113.255', 'documentation'],
    ['224.0.0.0', '239.255.255.255', 'multicast'],
    ['240.0.0.0', '255.255.255.254', 'reserved'],
  ];

  it.each(ranges)('blocks %s to %s (%s), both ends and a middle', (first, last, reason) => {
    blocked(first, reason);
    blocked(last, reason);
  });

  it('blocks the cloud metadata address and the broadcast address', () => {
    blocked('169.254.169.254', 'link-local');
    blocked('255.255.255.255', 'broadcast');
  });

  // The address just outside each range is public: a range written one bit too wide is as wrong as too narrow.
  it.each([
    '9.255.255.255',
    '11.0.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '126.255.255.255',
    '128.0.0.0',
    '169.253.255.255',
    '169.255.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '192.0.1.0',
    '192.0.3.0',
    '192.167.255.255',
    '192.169.0.0',
    '198.17.255.255',
    '198.20.0.0',
    '198.51.99.255',
    '198.51.101.0',
    '203.0.112.255',
    '203.0.114.0',
    '223.255.255.255',
  ])('allows %s, the neighbour of a blocked range', (address) => allowed(address));

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '151.101.1.69', '172.217.14.206'])(
    'allows the public address %s',
    (address) => allowed(address),
  );

  it.each([
    '',
    'localhost',
    '1.2.3',
    '1.2.3.4.5',
    '256.0.0.1',
    '1.2.3.-4',
    '010.0.0.1',
    '0x7f.0.0.1',
    '2130706433',
    '127.0.0.1/8',
    ' ',
    '1.2.3.4%eth0',
  ])('refuses %j, which is not a plain address', (address) => blocked(address, 'invalid-address'));
});

describe('the address policy: IPv6', () => {
  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456:789a::1', 'unique-local'],
    ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['febf:ffff::1', 'link-local'],
    ['fec0::1', 'site-local'],
    ['ff00::1', 'multicast'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['2001:db8:ffff::1', 'documentation'],
    ['2001::1', 'teredo'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'teredo'],
    ['2001:2::1', 'protocol-assignment'],
    ['3fff::1', 'documentation'],
    ['::1.2.3.4', 'ipv4-compatible'],
    ['100::1', 'reserved'],
    ['64:ff9b:1::1', 'reserved'],
    ['fe80::1%eth0', 'invalid-address'],
    ['[fe80::1]', 'link-local'],
  ])('blocks %s (%s)', (address, reason) => blocked(address, reason));

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '2a00:1450:4001:81b::200e',
    '2001:200::1',
    '2620:0:2d0:200::7',
    '3ffe::1',
  ])('allows the public address %s', (address) => allowed(address));

  it.each([
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['::FFFF:7F00:0001', false],
    ['0:0:0:0:0:ffff:7f00:1', false],
    ['::ffff:10.0.0.1', false],
    ['::ffff:a00:1', false],
    ['::ffff:192.168.1.1', false],
    ['::ffff:169.254.169.254', false],
    ['::ffff:a9fe:a9fe', false],
    ['::ffff:0.0.0.0', false],
    ['::ffff:8.8.8.8', true],
    ['::ffff:808:808', true],
    ['::ffff:0:127.0.0.1', false],
    ['::ffff:0:8.8.8.8', true],
  ])('judges the IPv4-mapped address %s by its IPv4 address (public: %s)', (address, ok) =>
    expect(classifyAddress(address).allowed, address).toBe(ok),
  );

  it.each([
    ['2002:7f00:1::1', false],
    ['2002:a00:1::', false],
    ['2002:c0a8:101::1', false],
    ['2002:a9fe:a9fe::1', false],
    ['2002:808:808::1', true],
    ['2002:5db8:d822::1', true],
  ])('judges the 6to4 address %s by its embedded IPv4 address (public: %s)', (address, ok) =>
    expect(classifyAddress(address).allowed, address).toBe(ok),
  );

  // A network with DNS64 gives every public IPv4 site an address in 64:ff9b::/96. Blocking the whole
  // prefix would make every site unreachable there; passing it all would reach the private IPv4 network.
  it.each([
    ['64:ff9b::808:808', true],
    ['64:ff9b::8.8.8.8', true],
    ['64:ff9b::5db8:d822', true],
    ['64:ff9b::a00:1', false],
    ['64:ff9b::10.0.0.1', false],
    ['64:ff9b::7f00:1', false],
    ['64:ff9b::127.0.0.1', false],
    ['64:ff9b::c0a8:101', false],
    ['64:ff9b::a9fe:a9fe', false],
    ['64:ff9b::169.254.169.254', false],
    ['64:ff9b::ac10:1', false],
    ['64:ff9b::6440:1', false],
    ['64:ff9b::0.0.0.0', false],
    ['64:ff9b::e000:1', false],
  ])('judges the NAT64 address %s by its embedded IPv4 address (public: %s)', (address, ok) =>
    expect(classifyAddress(address).allowed, address).toBe(ok),
  );

  it.each([
    '1:2:3:4:5:6:7:8:9',
    '12345::1',
    '::g',
    ':::',
    '1::2::3',
    '1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7::8',
    '::1.2.3',
    '::300.1.1.1',
    '1.2.3.4::',
  ])('refuses %j, which is not a valid IPv6 address', (address) =>
    blocked(address, 'invalid-address'),
  );
});

describe('validating an address that someone typed', () => {
  it('reads an ordinary address, strips the fragment and returns the canonical form', () => {
    expect(validateUrl('  https://Example.COM/Path?q=1#section  ')).toEqual({
      href: 'https://example.com/Path?q=1',
      protocol: 'https:',
      hostname: 'example.com',
      port: 443,
      path: '/Path?q=1',
      ipLiteral: false,
    });
    expect(validateUrl('http://example.com').href).toBe('http://example.com/');
    expect(validateUrl('http://example.com:80/x').port).toBe(80);
    expect(validateUrl('https://example.com./x').hostname).toBe('example.com');
  });

  it('keeps an internationalised name as its ASCII form', () => {
    expect(validateUrl('https://b\u00fccher.example/').hostname).toBe('xn--bcher-kva.example');
  });

  it('accepts an IP address written in the usual form, and leaves judging it to the address policy', () => {
    expect(validateUrl('http://93.184.216.34/page')).toMatchObject({
      hostname: '93.184.216.34',
      ipLiteral: true,
    });
    expect(validateUrl('https://[2606:4700:4700::1111]/')).toMatchObject({
      hostname: '2606:4700:4700::1111',
      ipLiteral: true,
    });
    expect(validateUrl('http://127.0.0.1/').hostname).toBe('127.0.0.1');
  });

  it.each([
    ['ftp://example.com/file', 'invalid'],
    ['file:///etc/passwd', 'invalid'],
    ['javascript:alert(1)', 'invalid'],
    ['data:text/html,hello', 'invalid'],
    ['//example.com/path', 'invalid'],
    ['example.com/path', 'invalid'],
    ['http:example.com', 'invalid'],
    ['http:\\\\example.com', 'invalid'],
    ['https:/example.com', 'invalid'],
    ['', 'invalid'],
    ['   ', 'invalid'],
    ['http://', 'invalid'],
    ['https://:443/', 'invalid'],
    ['http://exa mple.com/', 'invalid'],
    ['http://example.com/a b', 'invalid'],
    ['http://example.com/a\nb', 'invalid'],
    ['http://exam\tple.com/', 'invalid'],
    ['http://example.com/\u0000', 'invalid'],
    ['http://exa<mple.com/', 'invalid'],
    ['http://example.com:99999/', 'invalid'],
    ['http://example.com:abc/', 'invalid'],
    ['http://[::1/', 'invalid'],
    ['http://[fe80::1%25eth0]/', 'invalid'],
  ])('refuses the malformed address %j', (input, code) =>
    expect(failure(() => validateUrl(input)).code).toBe(code),
  );

  it.each([
    'http://user@example.com/',
    'http://user:secret@example.com/',
    'https://:secret@example.com/',
    'https://example.com@evil.example/',
    'http://@example.com/',
    'https://user:pw@[2606:4700:4700::1111]/',
  ])('refuses an address with a user name or password: %s', (input) =>
    expect(failure(() => validateUrl(input)).code).toBe('invalid'),
  );

  it.each([
    'http://localhost/',
    'http://LOCALHOST/',
    'http://localhost./',
    'http://app.localhost/',
    'http://a.b.localhost/',
    'http://printer.local/',
    'http://db.internal/',
    'http://svc.corp.internal/',
    'http://nas.lan/',
    'http://router.home.arpa/',
    'http://intranet/',
    'http://metadata/',
    'http://singlelabel/',
    'http://single-label./',
  ])('refuses the local or single-label name %s', (input) =>
    expect(failure(() => validateUrl(input)).code).toBe('blocked'),
  );

  it.each([
    // decimal, octal, hexadecimal and shortened spellings of 127.0.0.1
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0X7F000001/',
    'http://017700000001/',
    'http://0177.0.0.1/',
    'http://0x7f.0.0.1/',
    'http://0x7f.0x0.0x0.0x1/',
    'http://127.1/',
    'http://127.0.1/',
    'http://0/',
    'http://127.0.0.1./',
    'http://%31%32%37.0.0.1/',
    'http://\uff11\uff12\uff17.0.0.1/',
    // the cloud metadata address in other spellings
    'http://2852039166/',
    'http://0xa9fea9fe/',
    'http://0251.0376.0251.0376/',
    'http://169.254.43518/',
    // a private address as a number
    'http://167772161/',
    'http://3232235777/',
    'http://001.002.003.004/',
    'http://1.2.3/',
  ])('refuses the IP address written in an unusual form: %s', (input) =>
    expect(failure(() => validateUrl(input)).code, input).toBe('blocked'),
  );

  it('uses ports 80 and 443 only, unless it is configured otherwise', () => {
    for (const port of [22, 25, 81, 444, 3000, 6379, 8080, 8443, 9200, 11434]) {
      expect(failure(() => validateUrl(`https://example.com:${port}/`)).code).toBe('port');
    }
    expect(validateUrl('https://example.com:443/').port).toBe(443);
    expect(validateUrl('http://example.com:443/').port).toBe(443);
    expect(validateUrl('https://example.com:80/').port).toBe(80);
    expect(validateUrl('http://example.com:8080/', { allowedPorts: [8080] }).port).toBe(8080);
    expect(validateUrl('https://example.com:8443/', { allowedPorts: new Set([8443]) }).port).toBe(
      8443,
    );
    expect(failure(() => validateUrl('https://example.com/', { allowedPorts: [8080] })).code).toBe(
      'port',
    );
  });

  it('refuses an address longer than 2048 characters, before and after it is made canonical', () => {
    const base = 'https://example.com/';
    expect(validateUrl(base + 'a'.repeat(MAX_URL_LENGTH - base.length)).href).toHaveLength(
      MAX_URL_LENGTH,
    );
    expect(failure(() => validateUrl(base + 'a'.repeat(MAX_URL_LENGTH))).code).toBe('invalid');
    // Each of these characters becomes nine characters when it is written as percent escapes.
    expect(failure(() => validateUrl(base + '\u20ac'.repeat(400))).code).toBe('invalid');
  });

  it('refuses host names whose labels or whole are too long to exist', () => {
    expect(failure(() => validateUrl(`https://${'a'.repeat(64)}.example.com/`)).code).toBe(
      'invalid',
    );
    expect(
      failure(() => validateUrl(`https://${`${'a'.repeat(60)}.`.repeat(5)}example.com/`)).code,
    ).toBe('invalid');
  });

  it('applies an allowed-host list to names, exactly or by subdomain', () => {
    const allowedHosts = ['example.com', '*.docs.example.org'];
    expect(validateUrl('https://example.com/a', { allowedHosts }).hostname).toBe('example.com');
    expect(validateUrl('https://a.b.docs.example.org/', { allowedHosts }).hostname).toBe(
      'a.b.docs.example.org',
    );
    for (const input of [
      'https://www.example.com/',
      'https://example.org/',
      'https://docs.example.org/',
      'https://notexample.com/',
      'https://example.com.evil.example/',
      'https://93.184.216.34/',
    ]) {
      expect(failure(() => validateUrl(input, { allowedHosts })).code, input).toBe('blocked');
    }
    expect(validateUrl('https://anything.example/', { allowedHosts: [] }).hostname).toBe(
      'anything.example',
    );
  });

  it('checks the host before the port, so a refused host never reveals that its port was fine', () => {
    expect(failure(() => validateUrl('http://localhost:8080/')).code).toBe('blocked');
    expect(failure(() => validateUrl('http://127.1:8080/')).code).toBe('blocked');
  });
});
