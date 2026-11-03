import { APP_VERSION } from '../../../../shared/types.js';

/** The name robots.txt groups are matched against for this crawler. It is not the evidence fetcher's name. */
export const RESEARCH_ROBOTS_TOKEN = 'SwarmLab-ResearchCrawler';

export const RESEARCH_USER_AGENT = `${RESEARCH_ROBOTS_TOKEN}/${APP_VERSION} (research; honours robots.txt)`;
