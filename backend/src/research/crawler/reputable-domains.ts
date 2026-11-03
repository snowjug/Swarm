/**
 * Site lists the source classifier consults. They are HEURISTICS: a short, domain-neutral list of
 * widely known kinds of site, so that a page from one is read as that kind of source and ranked a
 * little higher. Being on a list says nothing about whether a page is right, and a site that is not
 * on one is not thereby wrong: it is simply not recognised. Edit the lists freely; each entry matches
 * the name and its subdomains (`example.org` matches `news.example.org`).
 */

/** Newsrooms with published standards: wire services, public broadcasters and national papers of record from several regions. */
export const REPORTING_DOMAINS: readonly string[] = [
  'reuters.com',
  'apnews.com',
  'afp.com',
  'bbc.com',
  'bbc.co.uk',
  'npr.org',
  'pbs.org',
  'cbc.ca',
  'abc.net.au',
  'sbs.com.au',
  'dw.com',
  'france24.com',
  'rfi.fr',
  'nhk.or.jp',
  'rte.ie',
  'aljazeera.com',
  'theguardian.com',
  'nytimes.com',
  'washingtonpost.com',
  'wsj.com',
  'ft.com',
  'economist.com',
  'bloomberg.com',
  'latimes.com',
  'theglobeandmail.com',
  'lemonde.fr',
  'spiegel.de',
  'zeit.de',
  'elpais.com',
  'asahi.com',
  'japantimes.co.jp',
  'straitstimes.com',
  'scmp.com',
  'thehindu.com',
  'irishtimes.com',
  'smh.com.au',
  'nzherald.co.nz',
  'propublica.org',
  'theatlantic.com',
  'newyorker.com',
  'technologyreview.com',
  'scientificamerican.com',
  'statnews.com',
  'theconversation.com',
];

/** Peer-reviewed publishers, indexes and identifiers. */
export const PUBLISHER_DOMAINS: readonly string[] = [
  'nature.com',
  'science.org',
  'sciencedirect.com',
  'springer.com',
  'springeropen.com',
  'wiley.com',
  'jstor.org',
  'plos.org',
  'bmj.com',
  'thelancet.com',
  'cell.com',
  'acm.org',
  'ieee.org',
  'nber.org',
  'jamanetwork.com',
  'nejm.org',
  'cambridge.org',
  'oup.com',
  'tandfonline.com',
  'sagepub.com',
  'frontiersin.org',
  'mdpi.com',
  'elifesciences.org',
  'pnas.org',
  'doi.org',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'europepmc.org',
];

/** Preprints and repositories: research that has not necessarily been reviewed. */
export const PREPRINT_DOMAINS: readonly string[] = [
  'arxiv.org',
  'biorxiv.org',
  'medrxiv.org',
  'chemrxiv.org',
  'ssrn.com',
  'zenodo.org',
  'osf.io',
  'researchsquare.com',
  'hal.science',
  'semanticscholar.org',
];

/** Bodies of governments that no country-code or `.gov` name says so for. */
export const INTERGOVERNMENTAL_DOMAINS: readonly string[] = [
  'europa.eu',
  'un.org',
  'worldbank.org',
  'imf.org',
  'oecd.org',
  'wto.org',
  'unesco.org',
  'bis.org',
];

/**
 * Public suffixes under which, by the rules of the registry that runs them, only governments (or, for `int`,
 * treaty organisations) may register a name. A name under one of them is a government's, and nothing
 * else is read as one: not a first label that is `gov` or `go`, not a name with `authority` in it, and not
 * a suffix that a service sells names under (`go.dyndns.org`) or that is open to anyone (`go.it` is Gorizia).
 * The list is not complete. A government that is not on it is not recognised, which is the safe answer.
 * Every entry must be a suffix from the ICANN part of the Public Suffix List (a test checks it).
 */
export const GOVERNMENT_SUFFIXES: readonly string[] = [
  'gov',
  'mil',
  'int',
  'gov.uk',
  'nhs.uk',
  'police.uk',
  'gov.au',
  'gov.ie',
  'govt.nz',
  'gc.ca',
  'gouv.fr',
  'gob.es',
  'gob.mx',
  'gob.ar',
  'gob.cl',
  'gob.pe',
  'gob.ec',
  'gov.br',
  'gov.co',
  'go.jp',
  'lg.jp',
  'go.kr',
  'go.th',
  'go.id',
  'go.tz',
  'go.ke',
  'go.ug',
  'go.cr',
  'gov.cn',
  'gov.hk',
  'gov.sg',
  'gov.my',
  'gov.in',
  'nic.in',
  'gov.il',
  'gov.tr',
  'gov.pl',
  'gov.it',
  'gov.ua',
  'gov.za',
  'gov.ng',
  'gov.pk',
  'gov.bd',
  'gov.lk',
  'gov.ph',
  'gov.vn',
  'gov.tw',
  'gov.eg',
  'gov.sa',
  'gov.ae',
  'gov.qa',
  'gov.gr',
  'gov.pt',
  'gov.cz',
  'gov.lv',
  'gov.lt',
  'gov.ee',
  'gov.rs',
  'gov.cy',
];

/**
 * Public suffixes under which, by the rules of their registries, only universities and colleges may
 * register a name. As for the government suffixes: a suffix that anyone may buy names under is not here,
 * the list is not complete, and every entry must be from the ICANN part of the Public Suffix List.
 */
export const ACADEMIC_SUFFIXES: readonly string[] = [
  'edu',
  'ac.uk',
  'ac.jp',
  'ac.kr',
  'ac.nz',
  'ac.za',
  'ac.in',
  'ac.il',
  'ac.cn',
  'ac.th',
  'ac.id',
  'ac.ke',
  'ac.at',
  'ac.be',
  'ac.cy',
  'ac.ir',
  'ac.lk',
  'ac.tz',
  'ac.ug',
  'ac.zw',
  'ac.ae',
  'edu.au',
  'edu.cn',
  'edu.hk',
  'edu.sg',
  'edu.my',
  'edu.br',
  'edu.mx',
  'edu.ar',
  'edu.co',
  'edu.tr',
  'edu.eg',
  'edu.sa',
  'edu.pk',
  'edu.ph',
  'edu.vn',
  'edu.tw',
  'edu.in',
  'edu.ng',
  'edu.gh',
];

/**
 * Sites that publish the documentation of their own products, and are widely known for it. A name that has
 * `docs` or `support` in it is not on this list for that: anyone can register one, so it says nothing, and
 * documentation is recognised from a name only where the person named the site. Each entry matches the name
 * and its subdomains.
 */
export const DOCUMENTATION_DOMAINS: readonly string[] = [
  'developer.mozilla.org',
  'docs.python.org',
  'learn.microsoft.com',
  'docs.microsoft.com',
  'developer.apple.com',
  'developer.android.com',
  'docs.aws.amazon.com',
  'docs.docker.com',
  'docs.github.com',
  'kubernetes.io',
  'react.dev',
  'go.dev',
  'doc.rust-lang.org',
  'php.net',
  'postgresql.org',
  'nodejs.org',
];

/** Places where the words are anyone's: forums, question sites, social networks and blog platforms. */
export const COMMUNITY_DOMAINS: readonly string[] = [
  'reddit.com',
  'redd.it',
  'quora.com',
  'stackexchange.com',
  'stackoverflow.com',
  'superuser.com',
  'serverfault.com',
  'askubuntu.com',
  'mathoverflow.net',
  'news.ycombinator.com',
  'lobste.rs',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'linkedin.com',
  'mastodon.social',
  'bsky.app',
  'threads.net',
  'pinterest.com',
  'tumblr.com',
  'medium.com',
  'substack.com',
  'discord.com',
  'discord.gg',
  't.me',
  'blogspot.com',
  'wordpress.com',
];

/** The kinds of structured data that mark a page as a discussion among people. */
export const DISCUSSION_TYPES: readonly string[] = [
  'DiscussionForumPosting',
  'QAPage',
  'Question',
  'Answer',
  'Comment',
];

/** The kinds that mark a page as scholarly work. */
export const SCHOLARLY_TYPES: readonly string[] = ['ScholarlyArticle', 'MedicalScholarlyArticle'];

/** Whether a host is the listed site or one of its subdomains. */
export const onList = (host: string, list: readonly string[]): boolean =>
  list.some((entry) => host === entry || host.endsWith(`.${entry}`));
