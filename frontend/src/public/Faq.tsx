import type { ReactNode } from 'react';
import { Disclosure } from '../design/ui';
import type { PublicSession } from '../../../shared/public';
import { POSITIONING_STATEMENT } from '../lib/product';
import { PublicFrame } from './PublicFrame';
import { useDocumentTitle } from './useDocumentTitle';

interface Entry {
  id: string;
  question: string;
  answer: ReactNode;
}

function names(session: Pick<PublicSession, 'providers'> | null): string {
  const labels = session?.providers.map((provider) => provider.label) ?? [];
  return labels.length
    ? new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels)
    : 'Google or GitHub, depending on what this site has turned on';
}

function entries(session: Pick<PublicSession, 'providers' | 'retentionDays'> | null): Entry[] {
  // The days a deleted account's counter is kept: what the site is set to, and the default until the page has heard.
  const days = session?.retentionDays ?? 30;
  return [
    {
      id: 'cost',
      question: 'What does it cost?',
      answer: (
        <>
          <p>
            Nothing is charged by this site. The free tier is capped for each person and for each
            day, and the site has a daily cap for everyone together.
          </p>
          <p>
            When your free runs are used up, they come back the next day. If you want more, bring
            your own Google Gemini key. Then your runs use your own Google quota, not ours.
          </p>
        </>
      ),
    },
    {
      id: 'key',
      question: 'Is my key safe?',
      answer: (
        <>
          <p>
            Your key is kept only in this browser tab&apos;s session storage. It is sent over HTTPS
            with each request that might use a model.
          </p>
          <p>
            The server holds it in memory only so that your run can finish, for a limited time. It
            never writes it to disk or to a log, and never shares it.
          </p>
          <p>
            Use a key with a spend limit. Forget key removes it from the tab and tells the server to
            drop its copy. Signing out does both too, and closing the tab removes it from the tab.
          </p>
        </>
      ),
    },
    {
      id: 'privacy',
      question: 'Is my data private?',
      answer: (
        <>
          <p>
            Each account has its own private workspace. Nobody else can see it, other users
            included, and the site owner does not browse projects.
          </p>
          <p>
            You can delete everything at any time from your account. After that,{' '}
            {days > 0 ? 'two things stay:' : 'one thing stays:'}
          </p>
          <ul>
            <li>
              An audit log that cannot be edited. It holds opaque ids and counts, never your text or
              your e-mail address.
            </li>
            {days > 0 && (
              <li>
                For {days} {days === 1 ? 'day' : 'days'}, a keyed counter of the free tokens your
                account used, so that signing up again cannot reset the free allowance. It holds no
                e-mail address.
              </li>
            )}
          </ul>
        </>
      ),
    },
    {
      id: 'free-tier-ends',
      question: 'What happens when the free tier runs out?',
      answer: (
        <>
          <p>
            You see a short message, not an error, and your work is kept. Free runs come back every
            day at 00:00 UTC.
          </p>
          <p>
            You can also use your own Google Gemini key to carry on right away. Reading, editing and
            the sample never use free runs.
          </p>
        </>
      ),
    },
    {
      id: 'sign-in',
      question: 'Which providers can I sign in with?',
      answer: (
        <>
          <p>
            You can sign in with {names(session)}. We only accept an e-mail address that the
            provider has verified.
          </p>
          <p>
            The same e-mail address through Google and through GitHub makes two separate accounts.
          </p>
        </>
      ),
    },
    {
      id: 'text',
      question: 'What does Swarm do with my text?',
      answer: (
        <>
          <p>
            Swarm reads your question and the evidence you add. A language model sees your text only
            when you run a model-assisted step.
          </p>
          <p>
            With the free tier that is a model the site owner pays for. With your own key it is
            Google&apos;s Gemini. Steps that use Swarm&apos;s own rules, like the sample, send your
            text to no model.
          </p>
        </>
      ),
    },
    {
      id: 'predict',
      question: 'Does Swarm predict what will happen?',
      answer: <p>No. {POSITIONING_STATEMENT}</p>,
    },
  ];
}

/** The questions people ask, short and honest. Each is closed until asked for. */
export function Faq({
  session,
  level = 2,
}: {
  session: Pick<PublicSession, 'providers' | 'retentionDays'> | null;
  level?: 1 | 2;
}) {
  const Title = level === 1 ? 'h1' : 'h2';
  return (
    <section className="sw-pub-faq" aria-labelledby="sw-pub-faq-title" data-testid="faq">
      <Title id="sw-pub-faq-title" className="sw-title">
        Questions people ask
      </Title>
      <div className="sw-pub-faq__list">
        {entries(session).map((entry) => (
          <Disclosure
            key={entry.id}
            heading={level === 1 ? 2 : 3}
            summary={entry.question}
            className="sw-pub-faq__item"
          >
            <div className="sw-pub-faq__answer">{entry.answer}</div>
          </Disclosure>
        ))}
      </div>
    </section>
  );
}

export function FaqPage({ session }: { session: PublicSession | null }) {
  useDocumentTitle('FAQ | Swarm');
  return (
    <PublicFrame session={session}>
      <Faq session={session} level={1} />
    </PublicFrame>
  );
}
