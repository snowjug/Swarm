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
