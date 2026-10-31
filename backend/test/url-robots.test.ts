import { describe, expect, it } from 'vitest';
import { parseRobots } from '../src/ingest/url/robots.js';

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

  it('reads only a bounded number of lines and rules, and ignores a huge pattern', () => {
    const lines = ['User-agent: *'];
    for (let index = 0; index < 20_000; index += 1) lines.push(`Disallow: /p${index}`);
    lines.push('Disallow: /late');
    expect(allows(lines.join('\n'), '/p1')).toBe(false);
    expect(allows(lines.join('\n'), '/late')).toBe(true);
    expect(
      allows(`User-agent: *\nDisallow: /${'a'.repeat(1_500)}\n`, `/${'a'.repeat(1_500)}`),
    ).toBe(true);
  });

  it('survives text that is not valid Unicode', () => {
    expect(allows('User-agent: *\nDisallow: /\ud800x\n', '/\ud800x')).toBe(false);
  });
});
