import { PIPELINE, POSITIONING_STATEMENT, WHAT_IF_LINE } from '../../lib/product';

/**
 * What the product is, said in the first seconds: the question it answers, the path from evidence to
 * a decision, and the one sentence it is never to be read without. It carries the page's one h1.
 */
export function LandingHero() {
  return (
    <section className="landing-hero" aria-labelledby="landing-heading">
      <div className="hero-main">
        <div className="hero-copy">
          <span className="eyebrow">SWARM · SCENARIO EXPLORATION</span>
          <h1 id="landing-heading">{WHAT_IF_LINE}</h1>
          <p className="hero-lede">
            Ask about a decision, a launch, a policy or a price. Swarm turns it into a scenario from
            your evidence, runs synthetic actors through it and compares the alternatives, so you
            can see what the evidence does and does not support.
          </p>
        </div>
        <p className="positioning-statement">{POSITIONING_STATEMENT}</p>
      </div>
      <ol className="pipeline" aria-label="How Swarm works">
        {PIPELINE.map((step, index) => (
          <li key={step.label}>
            <span className="pipeline-index" aria-hidden="true">
              {index + 1}
            </span>
            <strong>{step.label}</strong>
            <small>{step.caption}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
