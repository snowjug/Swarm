import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UrlEvidenceResult } from '../../api/evidence';
import { visibleText } from '../../test/provider';
import { UrlEvidence, UrlEvidenceView, type UrlEvidenceViewProps } from './UrlEvidence';

const result = (patch: Partial<UrlEvidenceResult['document']> = {}): UrlEvidenceResult => ({
  document: {
    name: 'shop.example.com - Acme Widget.txt',
    content: `Title: Acme Widget\n\n# Acme Widget\nThe Acme widget costs 19.99 EUR. ${'It ships within two working days. '.repeat(20)}`,
    provenance: {
      kind: 'url',
      url: 'https://shop.example.com/widget?token=[redacted]',
      finalUrl: 'https://shop.example.com/widget?token=[redacted]',
      retrievedAt: '2026-10-31T09:41:00.000Z',
      contentType: 'text/html',
      sha256: 'a'.repeat(64),
      title: 'Acme Widget',
      fetchedByServer: true,
    },
    ...patch,
  },
  notes: [
    'Retrieved public evidence: what the page said when Swarm read it on 2026-10-31. Swarm has not checked that it is true.',
    'The address sent the reader on to www.example.org.',
  ],
});

const view = (patch: Partial<UrlEvidenceViewProps> = {}) =>
  renderToStaticMarkup(
    <UrlEvidenceView
      address=""
      status="idle"
      result={null}
      error={null}
      disabled={false}
      remainingDocuments={4}
      onAddressChange={() => undefined}
      onFetch={() => undefined}
      onCancel={() => undefined}
      onAdd={() => undefined}
      onDiscard={() => undefined}
      {...patch}
    />,
  );

/** The tag that opens the first element with this text inside it. */
const tagOf = (html: string, pattern: RegExp): string => pattern.exec(html)?.[0] ?? '';

describe('adding a public web page', () => {
  it('starts as a labelled field and a button, and says what it will and will not do', () => {
    const html = view();
    const text = visibleText(html);
    expect(text).toContain('Add a public web page');
    expect(text).toContain('does not run scripts, sign in, or read private networks');
    expect(text).toContain('does not check that what the page says is true');
    expect(text).toContain('you can paste its text instead');
    const label = /<label for="([^"]+)">Web address<\/label>/u.exec(html);
    expect(label).not.toBeNull();
    const input = tagOf(html, /<input[^>]*>/u);
    expect(input).toContain(`id="${label![1]}"`);
    expect(input).toContain('type="text"');
    expect(input).toContain('inputMode="url"');
    expect(input).toContain('placeholder="https://example.com/page"');
    expect(input).toMatch(/aria-describedby="[^"]+"/u);
    // Nothing has been fetched, so there is nothing to show beyond the form.
    expect(html).not.toContain('url-evidence-preview');
    expect(html).not.toContain('role="alert"');
    // The announcement region is always present, so a screen reader hears it change, but silent until ready.
    expect(html).toContain('<div class="sr-only" role="status"></div>');
    expect(html).not.toContain('was fetched');
  });

  it('cannot fetch until there is an address, and then can', () => {
    expect(tagOf(view(), /<button[^>]*>Fetch page/u)).toContain('disabled');
    expect(tagOf(view({ address: '   ' }), /<button[^>]*>Fetch page/u)).toContain('disabled');
    expect(
      tagOf(view({ address: 'https://example.com/page' }), /<button[^>]*>Fetch page/u),
    ).not.toContain('disabled');
    expect(tagOf(view({ address: 'https://example.com/page' }), /<input[^>]*>/u)).toContain(
      'value="https://example.com/page"',
    );
  });

  it('is disabled while something else is going on, and says so when the project is full', () => {
    const busy = view({ address: 'https://example.com/', disabled: true });
    expect(tagOf(busy, /<input[^>]*>/u)).toContain('disabled');
    expect(tagOf(busy, /<button[^>]*>Fetch page/u)).toContain('disabled');

    const full = view({ address: 'https://example.com/', remainingDocuments: 0 });
    expect(tagOf(full, /<input[^>]*>/u)).toContain('disabled');
    expect(tagOf(full, /<button[^>]*>Fetch page/u)).toContain('disabled');
    expect(visibleText(full)).toContain('already has the most documents it can hold');
  });

  it('shows that it is working, can be cancelled, and cannot be asked again meanwhile', () => {
    const html = view({ address: 'https://example.com/', status: 'loading' });
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/role="status"/u);
    expect(visibleText(html)).toContain('Fetching the page');
    expect(tagOf(html, /<button[^>]*>Cancel/u)).toContain('type="button"');
    expect(tagOf(html, /<button[^>]*>Fetch page/u)).toContain('disabled');
    // Read-only rather than disabled, so that keyboard focus is not thrown away mid-request.
    expect(tagOf(html, /<input[^>]*>/u)).toContain('readOnly');
    expect(tagOf(html, /<input[^>]*>/u)).not.toContain('disabled');
    expect(view()).not.toContain('aria-busy');
  });

  it('shows a failure in words, as an alert, with the way out, and never the address that was typed', () => {
    const address = 'https://shop.example.com/secret-path?token=abc123';
    const message =
      'shop.example.com refused access (HTTP 403). Swarm reads only pages that are public without signing in. You can paste the text instead.';
    const html = view({ address, status: 'error', error: message });
    expect(html).toMatch(/role="alert"/u);
    const alert = html.slice(html.indexOf('role="alert"'));
    const text = visibleText(alert);
    expect(text).toContain('The page could not be read');
    expect(text).toContain(message);
    expect(text).toContain('You can paste the text instead.');
    expect(text).not.toContain('secret-path');
    expect(text).not.toContain('abc123');
    // The person's own text stays in the field so that it can be corrected.
    expect(tagOf(html, /<input[^>]*>/u)).toContain(`value="${address}"`);
    expect(tagOf(html, /<button[^>]*>Fetch page/u)).not.toContain('disabled');
  });

  it('shows the title, the site, the size, when it was read and a short excerpt, with the notes', () => {
    const found = result();
    const html = view({ status: 'ready', result: found });
    const text = visibleText(html);
    expect(text).toContain('Acme Widget');
    expect(html).toMatch(/<h4>Acme Widget<\/h4>/u);
    expect(text).toContain('Site shop.example.com');
    expect(text).toContain(`${found.document.content.length.toLocaleString('en-US')} characters`);
    expect(html).toContain('<time dateTime="2026-10-31T09:41:00.000Z">2026-10-31 09:41 UTC</time>');
    const excerpt = /<p class="url-evidence-excerpt">([^<]*)<\/p>/u.exec(html)?.[1] ?? '';
    expect(
      excerpt.startsWith('Title: Acme Widget # Acme Widget The Acme widget costs 19.99 EUR.'),
    ).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(321);
    expect(excerpt.endsWith('\u2026')).toBe(true);
    expect(text).toContain('Swarm has not checked that it is true');
    expect(text).toContain('The address sent the reader on to www.example.org.');
    expect(html).toContain(
      '<div class="sr-only" role="status">The page was fetched. Review it, then add it as evidence.</div>',
    );
    expect(tagOf(html, /<button[^>]*>Add as evidence/u)).not.toContain('disabled');
    expect(text).toContain('Discard');
    // The page's own address is not offered as a link to follow.
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
  });

  it('does not add a page when disabled or when the project is full', () => {
    const found = result();
    expect(
      tagOf(
        view({ status: 'ready', result: found, disabled: true }),
        /<button[^>]*>Add as evidence/u,
      ),
    ).toContain('disabled');
    expect(
      tagOf(
        view({ status: 'ready', result: found, remainingDocuments: 0 }),
        /<button[^>]*>Add as evidence/u,
      ),
    ).toContain('disabled');
  });

  it('shows text from the page as text: markup in a title or a note is escaped, never run', () => {
    const hostile = result({
      content:
        'A short page that says <script>alert(1)</script> and <img src=x onerror=alert(2)> in it.',
    });
    hostile.document.provenance.title = '<img src=x onerror=alert(3)><b>Bold</b> title';
    hostile.notes = ['A note with <script>alert(4)</script> in it'];
    const html = view({ status: 'ready', result: hostile });
    expect(html).not.toMatch(/<script|<img|<b>/u);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(3)&gt;&lt;b&gt;Bold&lt;/b&gt; title');
    expect(html).toContain('A note with &lt;script&gt;alert(4)&lt;/script&gt; in it');
  });

  it('falls back to the site, then the name, when the page has no title or a strange address', () => {
    const untitled = result();
    delete untitled.document.provenance.title;
    expect(view({ status: 'ready', result: untitled })).toMatch(/<h4>shop\.example\.com<\/h4>/u);
    const odd = result();
    delete odd.document.provenance.title;
    odd.document.provenance.url = 'not an address';
    delete odd.document.provenance.finalUrl;
    odd.document.provenance.retrievedAt = 'yesterday';
    const html = view({ status: 'ready', result: odd });
    expect(html).toMatch(/<h4>shop\.example\.com - Acme Widget\.txt<\/h4>/u);
    expect(visibleText(html)).toContain('Site Unknown');
    expect(visibleText(html)).toContain('Retrieved Unknown time');
  });

  it('renders as the form when it is used, and makes no request until it is asked to', () => {
    const html = renderToStaticMarkup(
      <UrlEvidence onAdd={() => undefined} disabled={false} remainingDocuments={3} />,
    );
    expect(visibleText(html)).toContain('Add a public web page');
    expect(tagOf(html, /<button[^>]*>Fetch page/u)).toContain('disabled');
    expect(html).not.toContain('url-evidence-preview');
  });
});
