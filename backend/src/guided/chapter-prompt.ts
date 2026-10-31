import { MAX_REVIEWED_CLAIMS } from '../grounding/normalize.js';
import { TARGET_CHAPTER_BODY } from './schemas.js';

/**
 * What a model is told when it writes one chapter of a report. The report writer and the studio's
 * regeneration of a single chapter use the same words, so a regenerated chapter is held to exactly
 * the rules the original was, and the review that follows checks it the same way.
 */
export const CHAPTER_INSTRUCTIONS =
  'Write the requested report chapter from supplied recorded data. JSON {body,sourceIds,memoryIds,interviewIds,claims}. ' +
  `body: plain text of 30-${TARGET_CHAPTER_BODY} characters; aim for 1,000-2,500 and keep it under ${TARGET_CHAPTER_BODY}. Cite only the IDs listed under allowedIds; sourceIds refer to original unverified documents, memoryIds to synthetic activity, interviewIds to generated fictional interviews. ` +
  'Distinguish these categories. Use metrics exactly; no calibrated forecasts, invented statistics or hidden reasoning. ' +
  `claims: 1-${MAX_REVIEWED_CLAIMS} atomic statements that your body makes and that carry its weight, each {text,kind,sourceIds,memoryIds,quote}. text restates something the body says (10-400 chars). ` +
  'kind is one of: source-fact (a passage states it; REQUIRES a quote copied exactly from a cited passage, and is otherwise shown as an extracted-claim), extracted-claim (a paraphrase of what a cited SOURCE passage says; use it only for the source text, never for what happened in the simulation), ' +
  'user-assumption (a setting, intervention or seed post), ai-hypothesis (your own speculation; cite nothing), simulated-event (something that happened in the simulation, such as a proxy posting, replying or changing its opinion; cite its memoryIds and cite no passage), ' +
  'analytical-conclusion (derived from the recorded metrics; use the exact figures). ' +
  "quote: JSON null (never an empty string) for every kind except source-fact and extracted-claim. For those two, use null unless you can copy ONE contiguous excerpt (12-300 characters) exactly from a passage listed in that same claim's sourceIds; never join sentences that are not next to each other, never reword inside a quote, and use null when unsure. " +
  'Each claim cites at most 3 passages and at most 3 memories. Each claim must restate something your body says, in words close to the body. ' +
  'If a supplied passage says anything relevant to this chapter, include at least one claim of kind source-fact or extracted-claim that restates what that passage says about the scenario’s starting conditions (never about the simulation’s results). ' +
  'Copy every ID exactly from allowedIds; never invent, alter or extend an ID (do not guess that a similar-looking memory exists), and never put an interview ID (I1, I2) or a passage ID in memoryIds. ' +
  'If no allowed ID fits a statement, give it a kind that cites nothing (analytical-conclusion or ai-hypothesis). ' +
  'Every number in the body and claims must come from the supplied metrics, timeline, memories or cited passages; do not invent statistics. The claims are independently checked.';
