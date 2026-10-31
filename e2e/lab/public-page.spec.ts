import { expect, test } from '@playwright/test';
import { watchPage } from '../support/helpers';

// "Fetch page" sits inside the entry form, and a browser does not deliver the submit of a form nested
// in another form to the page's handlers: a button that submitted its own form reloaded the page and
// emptied the entry form. Only a real browser shows it. The addresses used here are refused before any
// lookup, so the test needs no network.

const QUESTION = 'What could happen if a shop changes its checkout page?';

test('fetching a page answers in place, and neither the button nor Enter submits the entry form', async ({
  page,
}) => {
  const problems = watchPage(page, { refusals: true });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname);
  });
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  await page.goto('/');
  const loaded = navigations;
  const question = page.getByLabel('Your what-if question');
  const address = page.getByLabel('Web address');
  const refusal = page.getByRole('alert').filter({ hasText: 'The page could not be read' });
  await question.fill(QUESTION);

  await address.fill('http://127.0.0.1/');
  await page.getByRole('button', { name: 'Fetch page' }).click();
  await expect(refusal).toContainText('not one that Swarm reads');
  await expect(question).toHaveValue(QUESTION);

  // Typing clears the refusal, so the second one is the answer to Enter and nothing else.
  await address.fill('http://169.254.169.254/');
  await expect(refusal).toBeHidden();
  await address.press('Enter');
  await expect(refusal).toContainText('not one that Swarm reads');
  await expect(question).toHaveValue(QUESTION);

  expect(writes).toEqual(['/api/evidence/url', '/api/evidence/url']);
  expect(navigations).toBe(loaded);
  expect(problems).toEqual([]);
});
