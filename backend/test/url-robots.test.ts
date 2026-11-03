import { describe, expect, it } from 'vitest';
import { parseRobots, ROBOTS_MAX_BYTES } from '../src/ingest/url/robots.js';

const TOKEN = 'SwarmLab-EvidenceFetcher';
const allows = (robots: string, path: string, token = TOKEN) =>
  parseRobots(robots, token).allows(path);

describe('reading robots.txt (RFC 9309)', () => {
  it('allows everything when there is nothing to obey', () => {
    for (const robots of ['', '\n\n', '# only a comment', 'Sitemap: https://example.com/s.xml']) {
      expect(allows(robots, '/anything'), robots).toBe(true);
    }
  });

  it('ignores rules that come before any user-agent line, and an empty Disallow', () => {
    expect(allows('Disallow: /\nUser-agent: *\nDisallow:', '/page')).toBe(true);
    expect(allows('Disallow: /', '/page')).toBe(true);
  });

  it('matches the product token without regard to case, and prefers it to the * group', () => {
    const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: SWARMLAB-evidencefetcher\nAllow: /\n';
    expect(allows(robots, '/page')).toBe(true);
    expect(allows(robots, '/page', 'OtherBot')).toBe(false);
  });

  it('does not match a different token that merely contains ours, nor a prefix of it', () => {
    const robots =
      'User-agent: SwarmLab\nDisallow: /\n\nUser-agent: SwarmLab-EvidenceFetcher-2\nDisallow: /\n';
    expect(allows(robots, '/page')).toBe(true);
  });

  it('applies one group to every user-agent line above it, and merges groups that name the token', () => {
    const robots = [
      'User-agent: OtherBot',
      'User-agent: SwarmLab-EvidenceFetcher',
      'Disallow: /a',
      '',
      'User-agent: swarmlab-evidencefetcher',
      'Disallow: /b',
      '',
      'User-agent: *',
      'Disallow: /c',
    ].join('\n');
    expect(allows(robots, '/a')).toBe(false);
    expect(allows(robots, '/b')).toBe(false);
    expect(allows(robots, '/c')).toBe(true);
    expect(allows(robots, '/d')).toBe(true);
  });

  it('lets the longest matching pattern decide, and Allow win a tie', () => {
    const robots =
      'User-agent: *\nDisallow: /folder/\nAllow: /folder/page\nDisallow: /same\nAllow: /same\n';
    expect(allows(robots, '/folder/other')).toBe(false);
    expect(allows(robots, '/folder/page.html')).toBe(true);
    expect(allows(robots, '/same')).toBe(true);
  });

  it('supports * and a final $', () => {
    const robots = 'User-agent: *\nDisallow: /*.json$\nDisallow: /a*b*c\nDisallow: /end$\n';
    expect(allows(robots, '/data.json')).toBe(false);
    expect(allows(robots, '/data.json?x=1')).toBe(true);
    expect(allows(robots, '/data.jsonl')).toBe(true);
    expect(allows(robots, '/aXXbYYc')).toBe(false);
    expect(allows(robots, '/aXXb')).toBe(true);
    expect(allows(robots, '/end')).toBe(false);
    expect(allows(robots, '/ending')).toBe(true);
    expect(allows(robots, '/x/end')).toBe(true);
  });

  it('matches the query string as part of the path', () => {
    const robots = 'User-agent: *\nDisallow: /search?\nDisallow: /*?session=\n';
    expect(allows(robots, '/search?q=cats')).toBe(false);
    expect(allows(robots, '/search')).toBe(true);
    expect(allows(robots, '/page?session=1')).toBe(false);
    expect(allows(robots, '/page?other=1')).toBe(true);
  });

  it('treats a percent-escape and the character it stands for as the same, except for reserved ones', () => {
    const robots = 'User-agent: *\nDisallow: /~private\nDisallow: /a%2Fb\nDisallow: /caf\u00e9\n';
    expect(allows(robots, '/%7Eprivate')).toBe(false);
    expect(allows(robots, '/%7eprivate')).toBe(false);
    expect(allows(robots, '/a%2fb')).toBe(false);
    expect(allows(robots, '/a/b')).toBe(true);
    expect(allows(robots, '/caf%C3%A9')).toBe(false);
  });

  it('reads comments, CRLF and CR line ends, a byte-order mark, odd spacing and odd case', () => {
    const robots =
      '\uFEFFUSER-AGENT :   *   # everyone\r\nDISALLOW:/blocked # no\rAllow:  /blocked/ok\r\n';
    expect(allows(robots, '/blocked/x')).toBe(false);
    expect(allows(robots, '/blocked/ok')).toBe(true);
    expect(allows(robots, '/elsewhere')).toBe(true);
  });

  it('is not fooled by a user-agent line that follows a blank line or a comment', () => {
    const robots = 'User-agent: a\n\n# note\nUser-agent: SwarmLab-EvidenceFetcher\nDisallow: /x\n';
    expect(allows(robots, '/x')).toBe(false);
  });

  it('ignores lines it does not understand', () => {
    const robots = 'User-agent: *\nCrawl-delay: 10\nHost: example.com\nnonsense\nDisallow: /x\n:\n';
    expect(allows(robots, '/x')).toBe(false);
    expect(allows(robots, '/y')).toBe(true);
  });

  it('takes no longer to read a hostile pattern than its length times the path', () => {
    const robots = `User-agent: *\nDisallow: /${'*a'.repeat(400)}*b\n`;
    const started = Date.now();
    expect(allows(robots, `/${'a'.repeat(2_000)}`)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('obeys a rule however late in the file it comes, and however long its pattern is', () => {
    const lines = ['User-agent: *'];
    for (let index = 0; index < 20_000; index += 1) lines.push(`Disallow: /p${index}`);
    lines.push('Disallow: /late', 'Disallow: /private/');
    const text = lines.join('\n');
    expect(allows(text, '/p1')).toBe(false);
    expect(allows(text, '/p19999')).toBe(false);
    expect(allows(text, '/late')).toBe(false);
    expect(allows(text, '/private/report')).toBe(false);
    expect(allows(text, '/public')).toBe(true);
  });

  it('obeys the 2,501st rule, and a pattern of 1,001 characters, which were once left out', () => {
    const lines = ['User-agent: *'];
    for (let index = 0; index < 2_500; index += 1) lines.push(`Allow: /open${index}`);
    lines.push('Disallow: /private/');
    expect(allows(lines.join('\n'), '/private/x')).toBe(false);
    const long = `/${'a'.repeat(1_000)}`;
    expect(long).toHaveLength(1_001);
    expect(allows(`User-agent: *\nDisallow: ${long}\n`, `${long}/x`)).toBe(false);
    expect(allows(`User-agent: *\nDisallow: ${long}\n`, `${long.slice(0, -1)}`)).toBe(true);
    // A long pattern with wildcards can match a short path, so it is not one that could be left out as too long to match.
    const wild = `/${'*'.repeat(1_200)}private`;
    expect(allows(`User-agent: *\nDisallow: ${wild}\n`, '/x/private')).toBe(false);
    expect(allows(`User-agent: *\nDisallow: ${wild}\n`, '/x/public')).toBe(true);
  });

  it('reads as much as the limit allows, and forbids everything when there is more, rather than obeying what it could read', () => {
    const body = 'User-agent: *\nAllow: /\n';
    const justOver = `${body}${'#'.repeat(ROBOTS_MAX_BYTES - body.length - 1)}\nDisallow: /\n`;
    expect(justOver.length).toBeGreaterThan(ROBOTS_MAX_BYTES);
    expect(allows(justOver, '/page')).toBe(false);
    const filled = `User-agent: *\n${'#'.repeat(ROBOTS_MAX_BYTES - 40)}\nDisallow: /secret\n`;
    expect(filled.length).toBeLessThanOrEqual(ROBOTS_MAX_BYTES);
    expect(allows(filled, '/secret')).toBe(false);
    expect(allows(filled, '/open')).toBe(true);
    const over = `${body}${'#'.repeat(ROBOTS_MAX_BYTES)}`;
    expect(parseRobots(over, TOKEN).allows('/anything')).toBe(false);
    expect(parseRobots(over, TOKEN).crawlDelaySeconds).toBeNull();
  });

  it('takes tens of milliseconds, and no more, for the largest robots.txt that is read', () => {
    const fill = (head: string, line: string): string => {
      const lines = [head];
      for (
        let size = head.length;
        size + line.length + 1 <= ROBOTS_MAX_BYTES;
        size += line.length + 1
      ) {
        lines.push(line);
      }
      return lines.join('\n');
    };
    const path = `/${'b'.repeat(2_000)}`;
    const started = Date.now();
    for (const text of [
      fill('User-agent: *', 'allow:/'),
      fill('User-agent: *', 'Disallow: /*a*b$'),
      `User-agent: *\nDisallow: /${'*a'.repeat(250_000)}z\n`,
    ]) {
      const robots = parseRobots(text, TOKEN);
      for (let index = 0; index < 5; index += 1) robots.allows(`${path}${index}`);
    }
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('survives text that is not valid Unicode', () => {
    expect(allows('User-agent: *\nDisallow: /\ud800x\n', '/\ud800x')).toBe(false);
  });

  it('ends a comment at the end of the line, which is a CR, an LF or both, and no other character', () => {
    expect(allows('User-agent: *\nDisallow: /private # why\u2028not\n', '/private')).toBe(false);
  });

  it('reads a long line of comment marks and line separators in time in step with its length', () => {
    // Tried again from every `#`, a pattern for the comment took seconds for a line this long.
    const robots = `User-agent: *\nDisallow: /x\n${'#'.repeat(30_000)}\u2028\n`;
    const before = process.cpuUsage();
    expect(allows(robots, '/x')).toBe(false);
    const used = process.cpuUsage(before);
    expect((used.user + used.system) / 1_000).toBeLessThan(500);
  });
});
