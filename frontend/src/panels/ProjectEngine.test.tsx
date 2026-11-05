// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderWithApp, screen } from '../test/dom';
import { ProjectEngine } from './ProjectEngine';

describe('the engine of the open project, in the top bar', () => {
  it('says rules only for a project made without a model, in its name and in its words', () => {
    renderWithApp(<ProjectEngine mode="local" execution={null} />);
    const chip = screen.getByRole('img', { name: /^This project: Rules only\./u });
    expect(chip.getAttribute('data-engine')).toBe('rules');
    expect(chip.getAttribute('aria-label')).toContain('No model is called');
  });

  it('says model-assisted for a project made with one, and that what it proposes is labelled and reviewed', () => {
    renderWithApp(
      <ProjectEngine
        mode="llm"
        execution={{
          provider: 'foundry',
          model: 'swarm-chat',
          modelCalls: 3,
          inputTokens: 100,
          outputTokens: 20,
        }}
      />,
    );
    const chip = screen.getByRole('img', { name: /^This project: Model-assisted\./u });
    expect(chip.getAttribute('data-engine')).toBe('model');
    expect(chip.getAttribute('aria-label')).toContain('Microsoft Foundry · swarm-chat');
    expect(chip.getAttribute('aria-label')).toContain('waits for your review');
  });
});
