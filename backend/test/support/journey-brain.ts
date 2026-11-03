/**
 * The model that answers when the harness's Foundry is in its natural state (`behaviour: 'natural'`): a stand-in for a
 * model, held to the real schema by the fake Foundry and to the real checks by the product. It exists to test the path
 * (a strict schema out, a conforming answer in, the product's own checks, the label on the screen), and says nothing
 * about how any real model behaves.
 */
import type { FakeStep, RecordedRequest } from './fake-foundry.js';

/** What to answer a request with, or undefined when this stand-in has nothing to say to it. */
export function naturalReply(_request: RecordedRequest): FakeStep | undefined {
  return undefined;
}
