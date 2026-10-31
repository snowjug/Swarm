# Reading a public web page as evidence

Back to the [README](../../README.md). The settings are in [CONFIGURATION.md](../CONFIGURATION.md); the
wider threats are in [threat-model.md](../threat-model.md) and [security-model.md](../security-model.md).

## What it does, and what it does not

A person pastes the address of a public web page. **The server** (never the browser) fetches it, reads its
text, and returns it as a document the person can add to a project, with where it came from. The same
route reads a plain-text, Markdown, CSV or JSON file that is served at an address, and a CSV or JSON file
that is uploaded is read by the same code. Everything fetched is treated as **untrusted data**: it is text to
read, never an instruction, and nothing in it is run.

It is not a browser and not a crawler. There is no JavaScript, no images, no frames, no forms, no cookies
and no sign-in. It reads one page that a person named, once, when they ask. It does not read PDFs from an
address, follow links, or search the web, and the synthetic actors and critics have no network at all.

What Swarm retrieves is **what the page said when it was read**. Swarm does not check that it is true, and
says so with the document ("Retrieved public evidence: … has not checked that it is true").

## What happens to a request

`POST /api/evidence/url` with `{ "url": "…" }`. Only a person who may create a project in the workspace may
call it (`auth/policy.ts`). It is limited to 10 requests a minute for each caller address (times
`RATE_LIMIT_SCALE`), and the body to 8 KB.

1. **The address is checked as it was written** (`ingest/url/policy.ts`), before anything is looked up.
2. **The name is looked up and every answer is checked**, and the connection is made only to addresses that
   passed (`ingest/url/fetcher.ts`).
3. **robots.txt is read** through the same fetcher, and obeyed (RFC 9309).
4. **The page is requested** with a fixed set of headers, and read within a size and a time.
5. **Each redirect is followed by hand** and goes through steps 1 to 4 again.
6. **The body becomes text** without running anything (`extract.ts`, `boilerplate.ts`, `normalize.ts`).
   For a web page that means its own text, not its menus (see [What is kept of a web page](#what-is-kept-of-a-web-page)).
7. **The text becomes a document** with provenance, and notes that a person should read
   (`ingest.ts`, `provenance.ts`).
8. **The audit log records `evidence.url.fetched` with the host that was asked for**, and nothing else.
   An address the server refuses to read (`URL_BLOCKED`, `URL_PORT_NOT_ALLOWED`, `URL_INVALID`) is
   recorded as `evidence.url.refused` with the host that was asked for and the code, so that probing
   for addresses leaves a trace. A site that merely failed to answer is not recorded.

### The address policy

An address is refused, with a plain message, when it is any of these:

| Refused                                   | Detail                                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A scheme other than `http` or `https`     | `ftp:`, `file:`, `javascript:`, `data:`, and an address with no scheme                                                                                                                                                                                |
| A user name or password in the address    | `user:password@host`                                                                                                                                                                                                                                  |
| A space, a control character, or too long | More than 2,048 characters, before or after the address is made canonical                                                                                                                                                                             |
| A local or internal name                  | `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.lan`, `*.localdomain`, `*.intranet`, `*.corp`, `*.home`, `*.private`, `*.home.arpa`, and any name with a single label                                                                         |
| An IP address written in an unusual form  | Decimal (`2130706433`), octal (`0177.0.0.1`), hexadecimal (`0x7f.1`), short (`127.1`), padded with zeros, with a trailing dot or percent-escapes: only the usual dotted form is accepted                                                              |
| A port that is not allowed                | Only 80 and 443 unless `URL_INGEST_ALLOWED_PORTS` says otherwise                                                                                                                                                                                      |
| A host that is not on the allow list      | Only when `URL_INGEST_ALLOWED_HOSTS` is set                                                                                                                                                                                                           |
| A name that **resolves** to a bad address | If any one of its addresses is refused, the whole host is refused. The person is told "could not find it on the public web", exactly as for a name that does not exist, so the answer cannot be used to learn which names are in use inside a network |

The addresses that are never connected to (`classifyAddress`):

- **IPv4:** `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16` (this includes the cloud
  metadata address `169.254.169.254`), `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`,
  `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`,
  `255.255.255.255`.
- **IPv6:** only global unicast `2000::/3` is allowed at all, so `::`, `::1`, `fc00::/7`, `fe80::/10`,
  `fec0::/10`, `ff00::/8` and everything unallocated are refused; within it, `2001::/23` (this includes
  Teredo `2001::/32`), `2001:db8::/32` and `3fff::/20` are refused too.
- **Addresses that carry an IPv4 address are judged by it:** IPv4-mapped (`::ffff:a.b.c.d`), IPv4-translated,
  6to4 (`2002::/16`) and NAT64 (`64:ff9b::/96`). So `::ffff:127.0.0.1` and `64:ff9b::a00:1` are refused and
  `64:ff9b::808:808` is allowed. A network with DNS64 gives public sites NAT64 addresses, so refusing the whole
  prefix would make every site unreachable there.
- An answer that is not a plain IPv4 or IPv6 address is refused.

## Threats and what answers them

| Threat                                                      | What answers it                                                                                                                                                                                                                                                                 | Shown by                                                         | What remains                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSRF**: reach the cloud metadata service or the intranet  | The address policy above, applied to the typed address, to every answer of the name lookup and to every redirect. Private, loopback, link-local and metadata addresses are refused however they are written                                                                     | `url-policy.test.ts`, `url-fetcher.test.ts` (redirects)          | A network-specific NAT64 prefix looks like any other global IPv6 address and cannot be recognised. Put an egress rule at the network as well (see operator advice)                                                  |
| **DNS rebinding**: a name that answers public, then private | The name is looked up once for each request, every answer is checked, and the connection is made to those answers through a lookup that returns only them. The connection never looks the name up again. Each redirect hop is checked and pinned too                            | `url-fetcher.test.ts` (connects to the address that was checked) | Behind a transparent egress proxy the connection is to the proxy, which does its own lookup: pinning cannot see past it                                                                                             |
| **Redirects** to an internal address or another scheme      | Followed by hand, at most five. Each target goes through the whole check again (scheme, user name, host, port, allow list, name lookup). A redirect from https to http is not followed                                                                                          | `url-fetcher.test.ts` (judges every redirect target again)       | A page can send the reader to another public site, and the notes say so                                                                                                                                             |
| **Large or endless answers**                                | At most `URL_INGEST_MAX_BYTES` (1.5 MB) are read, a declared length above it is refused before reading, and the read stops at the limit. A total time (12 s) and a silence limit (5 s) apply, so a server that drips one byte at a time is stopped                              | `url-fetcher.test.ts` (size, slow-loris, idle)                   | Requests are limited for each caller address, not for the server as a whole: many callers can hold many fetches open at once, each for at most the time limit                                                       |
| **Many fetches at once**                                    | One caller: 10 requests a minute. The whole server: at most `URL_INGEST_CONCURRENCY` (8) pages at once and `URL_INGEST_QUEUE` (8) waiting in order for up to `URL_INGEST_QUEUE_WAIT_MS` (5 s); the rest get `503 URL_BUSY` and a `Retry-After`, naming nothing of the address   |
| **Decompression bombs**                                     | `Accept-Encoding: identity` is sent. If a server compresses anyway (gzip, deflate or Brotli), the output is counted and the read stops at the same limit, so a few kilobytes that expand to gigabytes are refused                                                               | `url-fetcher.test.ts` (decompression bombs)                      | A `deflate` body without a zlib header is refused as damaged                                                                                                                                                        |
| **A page that tries to run something**                      | It is only a string, scanned once by a small tokenizer (`extract.ts`). Nothing is evaluated, rendered, fetched or followed. Scripts, styles, templates, frames, drawings, form controls and comments are dropped; links keep their text and never their address                 | `url-extract.test.ts`                                            | A page can be built to be slow to scan: the amount of work is capped (150,000 tags, 400 levels of nesting, a bounded amount of text) and tested on pages made to be slow                                            |
| **Hidden text**                                             | Elements with `hidden`, `aria-hidden="true"`, `display:none`, `visibility:hidden`, `opacity:0` or `font-size:0` are dropped, with everything inside them. Zero-width and bidirectional controls, the Unicode tag block and other control characters are removed from every text | `url-extract.test.ts`                                            | Text hidden by a style sheet or a class (`.sr-only`, off-screen positioning, white on white) cannot be seen without rendering the page, which is not done: it is kept                                               |
| **Prompt injection in the page**                            | The page is data. Text that reads like an instruction to an AI is kept as text, is flagged by the existing injection check, and the notes warn the person. Actors and critics are given no tools, files or network                                                              | `url-extract.test.ts` (hostile pages), `url-route.test.ts`       | **Mitigated, not solved.** A model can still be influenced by visible text that is worded in a way the check does not know. See `models/injection.ts` for what it does and does not recognise                       |
| **robots.txt**                                              | Read through the same fetcher, as RFC 9309 says: a file that answers is obeyed for this fetcher's name and for `*`, a missing one (4xx) allows, and one that cannot be read (5xx, unreachable) refuses. It is read again for each site a redirect leads to                      | `url-fetcher.test.ts`, `url-robots.test.ts`                      | The rules in force are those at the moment of the fetch                                                                                                                                                             |
| **Identity and privacy**                                    | The request carries a fixed `User-Agent` (`SwarmLab-EvidenceFetcher/<version> (user-initiated evidence retrieval)`) and no cookie, credential or referrer, on every hop. The audit log keeps the host and nothing of the address or the page                                    | `url-fetcher.test.ts`, `url-route.test.ts`                       | The site sees this server's address and the time. A query value that looks like a secret is replaced by `[redacted]` in the stored address; a secret in the **path** cannot be told from the rest of it and is kept |
| **Claiming to be a retrieved page**                         | `fetchedByServer` is set only here. The server remembers the hash of each page it fetched for a person for an hour; a project created with a document that claims to be fetched keeps it only for that exact text and person, and otherwise the document is pasted text         | `url-provenance.test.ts`, `url-route.test.ts`                    | The memory is in the process: after a restart, or on another replica, a real page is counted as pasted. That says less, never more                                                                                  |
| **A page that is wrong**                                    | Labelled "retrieved public evidence" with its address, time, type and a hash of the text; the document says if it was cut                                                                                                                                                       | `url-route.test.ts`                                              | Swarm does not know whether a page is true, current, complete or the same for everyone                                                                                                                              |

## What is kept of a web page

A web page is its own text with page furniture around it: menus, side panels, footers, cookie notices, share
buttons, the markers and edit links of an encyclopedia. A browser shows all of it. Swarm keeps the page's own
text, so that what is read from a page, and later cited from it, is what a person would read.

**This is a guess from how the page is built** (`extract.ts`, `boilerplate.ts`), by conventions most pages
follow. No site is treated differently from another. It can leave out something that matters, and it can keep
something that does not. The notes say so whenever anything was left out, and **the person can always paste
the text instead**.

### What is never read

Scripts, styles, templates, frames, objects, drawings, form controls, comments, and anything marked `hidden`,
`aria-hidden="true"`, `display:none`, `visibility:hidden`, `opacity:0` or `font-size:0`. That does not depend on
anything below. The `noscript` parts of a page are not the page's own text either; they are read only as a
fallback, and never mixed with it (see "Text kept for readers without scripts").

### What is left out as furniture

| Kind                | What                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Elements            | `nav`, `aside`, `footer`, `dialog`, `search`, and a `header` that is not inside an `article`, `main` or `section` (inside one of them it is the heading of that part and stays)                                                                                                                                                    |
| Roles               | `navigation`, `banner`, `contentinfo`, `complementary`, `search`, `menu`, `menubar`, `dialog`, `alertdialog`, `doc-noteref`, `doc-backlink`, on any element                                                                                                                                                                        |
| Class names or ids  | `sidebar`, `navbar`, `navbox`, `nav`, `navigation`, `toc`, `breadcrumb`, `breadcrumbs`, `skip-link`, `skip-links`, `skiplink`, `cookie-banner`, `cookie-notice`, `cookie-consent`, `cookie-bar`, `cookiebanner`, `consent-banner`, `gdpr-banner`, `modal`, `popup`, `advert`, `adverts`, `advertisement`, `ad-slot`, `adsbygoogle` |
| Class names only    | `cookie`, `cookies`, `consent`, `share`, `sharing`, `social`, `newsletter`, `subscribe`, `noprint`, `no-print`, `headerlink`, `footnote-ref`, `hatnote`, `mw-editsection`, `mw-jump-link`, `mw-portlet-lang`, `editsection`, `catlinks`, `printfooter`, `reflist`                                                                  |
| Only on one element | the class `reference` on a `sup` (the marker of a citation) and the class `references` on an `ol` (the list of citations)                                                                                                                                                                                                          |

- A name counts only **whole**: `sidebar` is a side panel, `sidebar-layout` and `sidebars` are not. Names are
  compared in lower case, and each class of an element is a name of its own.
- An **id** is read only on a `div`, `ul`, `ol`, `table` or `form`, and only the names in the third row. A
  heading or a section often gets an id made from its own words (`share`, `references`), and what is under it
  is not furniture.
- `reference` and `references` are read only on those elements: a documentation generator puts `reference` on
  every link, and the text of a link is the page's.
- **Never left out, whatever it is called:** `html`, `body`, `main`, `article`, and any element with the role
  `main`.
- Everything inside furniture is left out with it. The cells of a table that is left out leave no stray `|`
  behind.

### The main region

If the page has a `main` element or an element with the role `main`, and it holds a substantial part of the
text, **only the text inside it is kept**. Without one, the `article` elements stand in for it: those that are
not inside another, and each at least a quarter the size of the largest, so that a story is not read together
with the teasers of others. Of several `main` regions the largest is used.

A region is substantial when it has at least 400 characters and at least a quarter of the page's text outside
its furniture, or at least 200 characters and at least half of it. A `main` of a few words, or one that holds
only a small part of the page, is not the page's text: then the page is read as a whole, minus its furniture.
A page with 2,000 or more regions is read that way too, without choosing one.

### When that leaves too little

If what is kept is under 200 characters while the page shows at least twice as much, and at least 80 characters
more, **the page is read whole**, as it was read before furniture was told apart, and the notes say so. A site
that puts its content in an element called `sidebar` does not become an empty document.

### Text kept for readers without scripts

Swarm does not run scripts, so a page's `noscript` parts are what a reader without scripts is shown. They are
read as **a fallback** and in no other way: only when the rest of the page has under 200 characters of text and
the `noscript` text has at least 200, twice as much and 80 more. It then **replaces** the page's own text, and is
never mixed with it. It is read as markup under every rule above (hidden text, furniture, scripts, styles and
frames inside it are left out, and none of it is run), at most 100,000 characters of it are kept, and a
`noscript` that is hidden, or inside something hidden or inside furniture, is not read at all. The notes say
that this is the text the page keeps for readers without scripts.

A `noscript` that only asks for scripts ("You need to enable JavaScript to run this app.") is too short to
count, so such a page still gets the message that it needs JavaScript or has no readable text.

### What scripts build, and frames

What a script builds, or what a frame shows from another page, is not in the page that was fetched, and Swarm
reads neither. It says so, in one note, when either holds:

- most of the page is code: at least half of its characters are inside `script` elements (not counting scripts
  that hold data, such as JSON), and what is kept is at most a tenth of the page; or
- what was kept has a frame, an object or an embed that shows another document to a reader: not hidden, not a
  pixel, not blank, and not inside furniture.

### When a page is not read to its end

A page with more than 150,000 tags, or nested more than 400 levels deep, is read no further than that point.
Such a page is **marked**: `reading` says it was cut short, the text ends with the notice of a document that was
cut to fit ("[Swarm shortened this page: only the beginning was kept.]"), and the notes say so. A page with
only tags or white space after the cap is not marked, since nothing was lost. When too little had been read by
then to make a document, the answer says that Swarm stopped before the end of the page, not that it needs
JavaScript.

### What does not change

- The title, the description and the facts for machines (JSON-LD) are read wherever they are in the page,
  including inside furniture.
- The caps on tags (150,000), nesting (400 levels), attributes (40 to a tag, 2,000 characters each) and text
  (200,000 characters) are the same, and a page is read in time that grows in step with its size. Pages built
  to be slow are tested for that (`url-extract.test.ts`).
- `sha256` is of the text that is returned, and a quote that is cited later is a quote of that text.

What a person sees in the notes:

- Something left out, with a main region: "Swarm kept the main text of the page and left out its menus, side
  panels, footers and similar parts. It decides this from how the page is built, so it can leave out something
  that matters. You can paste the text instead."
- Something left out, without one: "Swarm left out the menus, side panels, footers and similar parts of the
  page. It decides this from how the page is built, so it can leave out something that matters. You can paste
  the text instead."
- The whole page read: "Swarm could not tell the page's own text from its menus and side panels, so it kept
  everything the page shows, menus included. Some of it may not be what the page is about. You can paste the
  text instead."
- The text kept for readers without scripts: "Swarm does not run scripts, and this page shows almost no text
  without them, so it kept the text the page holds for readers without scripts (its noscript part). A browser
  that runs scripts may show more. You can paste the text instead."
- Scripts or frames: "Parts of this page are built by scripts or shown from other pages (frames), and Swarm
  reads neither, so a table or list that a browser shows there may be missing. You can paste the text instead."
- A page not read to its end: "Swarm stopped reading this page before its end, because it has more tags, or is
  nested more deeply, than Swarm reads, so only the beginning was kept. The text says so. You can paste the text
  instead."
- Nothing left out, and a file that is not a web page: no note about this.

## What the document is

The route returns `{ document: { name, content, provenance }, notes }`.

- **`content`** is plain text: `Title:` and `Description:` lines, the headings (`#`), paragraphs, list items
  (`-`) and table rows (cells joined with `|`), then the facts the page publishes for machines (JSON-LD),
  listed as `Type.field: value` lines under `Structured data:`. JSON is read as `path: value` lines and CSV as
  its columns and then `Row n: column: value` lines, with a limit on depth, items, rows, columns and the size of
  a value. A quote that comes after only spaces opens a quoted field (`"a", "b"` is read as two fields, as many
  files are written); a quote anywhere else in a field is kept as text, and the notes say so. A document is at
  most 40,000 characters; when the page is longer the end is cut and the text says so, and the structured facts
  are kept.
- **`provenance`** is `{ kind: 'url', url, finalUrl, retrievedAt, contentType, sha256, title,
fetchedByServer: true }`. The addresses have no fragment and have the value of any query parameter named
  like a secret replaced by `[redacted]` (`token`, `key`, `api_key`, `secret`, `password`, `auth`, `sig`,
  `signature`, `session`, `code`, `access_token`, `x-amz-*` and similar). `sha256` is of the text as it is
  stored.
- **`notes`** say that this is retrieved evidence that Swarm has not checked, whether the page's menus and the
  like were left out (and that this is a guess), whether its text is what it keeps for readers without scripts,
  whether parts built by scripts or shown from other pages were not read, whether the page was cut (because it
  is longer than a document can be, or because it has more tags or is nested more deeply than is read), whether
  structured data is included, whether a table kept quotation marks as text, whether the address sent the
  reader to another site, and whether the text reads like instructions to an AI.
- The **name** is made from the host and the title with only letters, digits and a few marks, so it is always a
  valid document name.

## When it cannot read a page

A message may name the site, never the address or its path, and every one ends with "You can paste the text
instead."

| Code                     | When                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `URL_INVALID`            | Not a web address Swarm can read (400)                                                                                   |
| `URL_BLOCKED`            | Not a public web page: a private, local or internal address or name as written, or not allowed                           |
| `URL_PORT_NOT_ALLOWED`   | A port that is not allowed                                                                                               |
| `URL_UNSUPPORTED_TYPE`   | The site sent a type of file that is not read                                                                            |
| `URL_TOO_LARGE`          | More than `URL_INGEST_MAX_BYTES`, before or after decompression                                                          |
| `URL_TIMEOUT`            | The whole fetch took more than `URL_INGEST_TIMEOUT_MS`, or the site went quiet                                           |
| `URL_TOO_MANY_REDIRECTS` | More than five                                                                                                           |
| `URL_ROBOTS_DISALLOWED`  | The site asks that the page is not fetched, or its robots.txt could not be read                                          |
| `URL_NO_TEXT`            | Fewer than 80 characters of readable text: the page may need JavaScript, or was not read to its end                      |
| `URL_FETCH_FAILED`       | The name was not found, the connection failed, the certificate could not be verified, or the site answered with an error |
| `URL_INGESTION_DISABLED` | `URL_INGESTION=off` (403)                                                                                                |
| `URL_BUSY`               | The server is reading as many pages as it allows, and the line to wait is full or too slow (503)                         |

The allowed types are `text/html`, `application/xhtml+xml`, `text/plain`, `text/markdown`, `text/csv` and
`application/json`. The type is taken from what the site says and is not guessed.

## Settings

| Variable                   | Default   | Meaning                                                                                              |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `URL_INGESTION`            | `on`      | `off` turns the route off; `GET /api/config` then reports `urlIngestion: false` so the page hides it |
| `URL_INGEST_ALLOWED_PORTS` | `80,443`  | Ports a page may be read from                                                                        |
| `URL_INGEST_MAX_BYTES`     | 1,500,000 | Most bytes read from a page, before and after decompression (10,000 to 5,000,000)                    |
| `URL_INGEST_TIMEOUT_MS`    | 12,000    | The whole fetch: lookups, redirects, robots.txt and the page (1,000 to 25,000)                       |
| `URL_INGEST_ALLOWED_HOSTS` | empty     | If set, only these hosts: `example.com` exactly, or `*.example.com` for its subdomains               |
| `URL_INGEST_CONCURRENCY`   | 8         | Pages read at the same moment by this process, for every caller together (1 to 64)                   |
| `URL_INGEST_QUEUE`         | 8         | Requests that may wait for one of those places; beyond that, `503 URL_BUSY` (0 to 64)                |
| `URL_INGEST_QUEUE_WAIT_MS` | 5,000     | How long a request may wait for a place before it is refused the same way (100 to 15,000)            |

There is deliberately **no setting that allows private or loopback addresses**. A test can allow loopback only
through the constructor of the fetcher, which nothing in the configuration, the environment or a request can
reach, and then only loopback: every other private range stays refused (`url-fetcher.test.ts`).

## Operator advice

- **Add a network rule as well.** The checks here are in the application. A deployment should also deny the
  application's outbound traffic to private ranges, link-local addresses (including the metadata address) and
  the internal network, so that a mistake in the application is not the only thing between a page and an
  internal service.
- **Use the allow list** (`URL_INGEST_ALLOWED_HOSTS`) when people only need pages from a known set of sites, and
  turn the feature off (`URL_INGESTION=off`) where a server may not reach the internet.
- **Know what leaves.** The site sees this server's address and the time. The audit log records the host of
  every fetch (`evidence.url.fetched`); it does not record the address, the page or the person's question.
- **Replicas and restarts.** Retrieval provenance is remembered for an hour in the process that fetched the page.
  Behind several replicas without a sticky session, a document may be recorded as pasted text. That is the safe
  direction.
- **Proxies.** Swarm connects directly and does not use a proxy of its own. If the network sends its outbound
  traffic through a transparent proxy, that proxy does its own lookup, and is the place that has to enforce the
  rule.
- **Egress by name.** A server that resolves names through its operating system also reads the hosts file: do not
  point a public-looking name at a private address there.

## What is not done

- No JavaScript is run, so a page that builds its content in the browser yields nothing: the person is told to
  paste the content instead.
- Text hidden by a style sheet cannot be told from text that is shown.
- Which part of a web page is its own text is a guess from its markup (see [What is kept of a web
  page](#what-is-kept-of-a-web-page)). It goes wrong both ways: a `div` called `share` that holds real text is
  left out, while a footnote that a page shows inside its sentences, a list of related stories or a comment
  section inside the main region is kept, and a heading whose list was left out stays. Names are matched whole,
  so `site-footer` is not `footer`.
- No PDFs, images or other types are read from an address; no authenticated pages; no crawling.
- A network-specific NAT64 prefix, an ISATAP address and an egress proxy are outside what an address check can
  see.
- Prompt injection is reduced, not removed. What a page says can still shape what a model writes if the model
  follows it; actors and critics have no tools to turn that into an action.
- The limit on fetches in progress is for one process. Behind several replicas each keeps its own, so the
  site as a whole may read that many pages for each replica at once. A fetch whose client has gone is not
  stopped: it holds its place until the page arrives or the time is up, and then gives it back.

## Checking it

```
node node_modules/vitest/vitest.mjs run backend/test/url-policy.test.ts backend/test/url-fetcher.test.ts backend/test/url-robots.test.ts backend/test/url-extract.test.ts backend/test/url-normalize.test.ts backend/test/url-provenance.test.ts backend/test/url-route.test.ts backend/test/url-limiter.test.ts backend/test/url-config.test.ts backend/test/url-upload.test.ts
```

The fetcher tests talk only to servers on this machine, through the constructor's test option and a stub name
resolver; none of them reaches the network.
