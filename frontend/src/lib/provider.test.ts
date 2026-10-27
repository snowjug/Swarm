import { describe, expect, it } from 'vitest';
import type { ExecutionInfo } from '../../../shared/types';
import { localStatusFixture, realStatusFixture } from '../test/provider';
import {
  LOCAL_MODE_LABEL,
  TOKENS_NOT_REPORTED,
  authText,
  connectivityChip,
  connectivityText,
  modelReadiness,
  projectModeChip,
  projectUsageText,
  providerBadgeView,
  providerChangeAnnouncement,
  providerLabel,
  providerName,
  realModelLabel,
  tokensText,
} from './provider';

describe('provider labels', () => {
  it('uses the exact local label and one unmistakable label per real provider', () => {
    expect(LOCAL_MODE_LABEL).toBe('LOCAL / RULES MODE');
    expect(providerLabel(localStatusFixture())).toBe('LOCAL / RULES MODE');
    expect(realModelLabel('azure')).toBe('REAL AZURE AI');
    expect(realModelLabel('openai')).toBe('REAL MODEL · OpenAI');
    expect(realModelLabel('ollama')).toBe('REAL MODEL · Ollama (local)');
    expect(providerLabel(realStatusFixture({ provider: 'openai' }))).toBe('REAL MODEL · OpenAI');
  });

  it('never labels a configured real model as local rules', () => {
    for (const provider of ['azure', 'openai', 'ollama', 'none'] as const) {
      expect(realModelLabel(provider)).toMatch(/^REAL /u);
      expect(providerLabel(realStatusFixture({ provider }))).not.toContain('LOCAL');
    }
  });

  it('describes authentication without ever naming a secret', () => {
    expect(authText('entra')).toBe('Microsoft Entra ID — no API key');
    expect(authText('api-key')).toBe('API key (kept on the server)');
    expect(authText('none')).toBe('none');
    expect(authText(undefined)).toBe('not reported by this server');
    expect(providerName('azure')).toBe('Azure AI');
    expect(providerName('ollama')).toBe('Ollama (local)');
  });

  it('states connectivity in words, not colour alone', () => {
    expect(connectivityChip('unverified')).toMatchObject({ text: 'not verified yet' });
    expect(connectivityChip('ok')).toMatchObject({ text: 'connected', tone: 'ok' });
    expect(connectivityChip('failing')).toMatchObject({ text: 'failing', tone: 'failing' });
    expect(connectivityText('not-applicable')).toBe('not applicable');
    for (const connectivity of ['unverified', 'ok', 'failing'] as const) {
      expect(connectivityChip(connectivity).text).toBe(connectivityText(connectivity));
    }
  });
});

describe('provider badge view', () => {
  it('says only that it is checking before the first status arrives', () => {
    expect(providerBadgeView(null, false)).toMatchObject({
      kind: 'checking',
      label: 'MODEL PROVIDER',
      chip: { text: 'checking…' },
    });
  });

  it('says "status unavailable" instead of guessing when nothing was ever read', () => {
    const view = providerBadgeView(null, true);
    expect(view).toMatchObject({ kind: 'unavailable', chip: { text: 'status unavailable' } });
    expect(view.label).not.toMatch(/LOCAL|REAL/u);
  });

  it('shows a local status with no connectivity chip and no model name', () => {
    expect(providerBadgeView(localStatusFixture(), false)).toMatchObject({
      kind: 'local',
      label: 'LOCAL / RULES MODE',
      model: null,
      chip: null,
    });
  });

  it.each([
    ['azure', 'REAL AZURE AI'],
    ['openai', 'REAL MODEL · OpenAI'],
    ['ollama', 'REAL MODEL · Ollama (local)'],
  ] as const)('shows %s with its model and connectivity chip', (provider, label) => {
    expect(
      providerBadgeView(realStatusFixture({ provider, model: 'deployed-model' }), false),
    ).toMatchObject({
      kind: 'real',
      label,
      model: 'deployed-model',
      chip: { text: 'not verified yet' },
    });
  });

  it('keeps the last known provider but replaces connectivity when a later read failed', () => {
    expect(providerBadgeView(realStatusFixture({ connectivity: 'ok' }), true)).toMatchObject({
      kind: 'real',
      label: 'REAL AZURE AI',
      chip: { text: 'status unavailable' },
    });
    expect(providerBadgeView(localStatusFixture(), true)).toMatchObject({
      kind: 'local',
      chip: { text: 'status unavailable' },
    });
  });

  it('does not invent a model name when the server reports none', () => {
    expect(providerBadgeView(realStatusFixture({ model: null }), false).model).toBe(
      'model not specified',
    );
  });
});

describe('provider change announcements', () => {
  const unverified = realStatusFixture();
  const connected = realStatusFixture({ connectivity: 'ok' });

  it('is silent for the first read and for routine polls that changed nothing', () => {
    expect(providerChangeAnnouncement(null, unverified, false)).toBe('');
    expect(providerChangeAnnouncement(unverified, realStatusFixture(), false)).toBe('');
    expect(
      providerChangeAnnouncement(
        connected,
        realStatusFixture({
          connectivity: 'ok',
          lastCheckedAt: '2026-01-01T00:01:00.000Z',
          counters: { ...connected.counters, calls: 9, inputTokens: 5 },
        }),
        false,
      ),
    ).toBe('');
  });

  it('announces a connectivity change in words', () => {
    expect(providerChangeAnnouncement(unverified, connected, false)).toBe(
      'Model provider connectivity is now connected.',
    );
    expect(
      providerChangeAnnouncement(connected, realStatusFixture({ connectivity: 'failing' }), false),
    ).toBe('Model provider connectivity is now failing.');
  });

  it('announces a different provider or mode and a recovered status read', () => {
    expect(providerChangeAnnouncement(localStatusFixture(), unverified, false)).toBe(
      'Model provider is now REAL AZURE AI, swarm-dev-deployment, not verified yet.',
    );
    expect(providerChangeAnnouncement(connected, connected, true)).toBe(
      'Model provider status is available again: REAL AZURE AI, swarm-dev-deployment, connected.',
    );
  });
});

describe('provider token text', () => {
  it('says tokens are not reported instead of showing a misleading zero', () => {
    expect(tokensText(realStatusFixture())).toBe(TOKENS_NOT_REPORTED);
    expect(TOKENS_NOT_REPORTED).toBe('not reported by provider — zero does not mean zero cost');
  });

  it('shows reported input and output tokens', () => {
    const status = realStatusFixture();
    status.counters = {
      ...status.counters,
      tokensReported: true,
      inputTokens: 120,
      outputTokens: 30,
    };
    expect(tokensText(status)).toBe('120 / 30');
  });

  it('is not a provider claim in local mode', () => {
    expect(tokensText(localStatusFixture())).toBe('none: no model is called');
  });
});

describe('per-project mode chip', () => {
  const execution = (patch: Partial<ExecutionInfo>): ExecutionInfo => ({
    provider: 'azure',
    model: 'gpt-4o-mini',
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    ...patch,
  });

  it('labels a local project as local rules, with no model', () => {
    expect(projectModeChip({ mode: 'local', execution: null })).toEqual({
      label: 'LOCAL / RULES MODE',
      model: null,
      real: false,
    });
    expect(
      projectModeChip({ mode: 'local', execution: execution({ provider: 'none', model: null }) }),
    ).toMatchObject({ label: 'LOCAL / RULES MODE', real: false });
  });

  it.each([
    ['azure', 'REAL AZURE AI'],
    ['openai', 'REAL MODEL · OpenAI'],
    ['ollama', 'REAL MODEL · Ollama (local)'],
  ] as const)('labels a %s project with its recorded model', (provider, label) => {
    expect(
      projectModeChip({ mode: 'llm', execution: execution({ provider, model: 'recorded-model' }) }),
    ).toEqual({ label, model: 'recorded-model', real: true });
  });

  it('never calls a model project local while its execution is not yet recorded', () => {
    for (const recorded of [null, execution({ provider: 'none', model: null })]) {
      const chip = projectModeChip({ mode: 'llm', execution: recorded });
      expect(chip.real).toBe(true);
      expect(chip.label).toBe('REAL MODEL · provider not recorded yet');
      expect(chip.model).toBeNull();
    }
  });
});

describe('per-project usage text', () => {
  const usage = (modelCalls: number, inputTokens: number, outputTokens: number) =>
    projectUsageText({ provider: 'azure', model: 'm', modelCalls, inputTokens, outputTokens });

  it('keeps the existing call and token wording, without separators that would break matching', () => {
    expect(usage(3, 1204, 311)).toBe('3 real model calls · 1204 input / 311 output tokens');
    expect(usage(0, 0, 0)).toBe('0 real model calls · 0 input / 0 output tokens');
  });

  it('says tokens were not reported when calls happened but both counts are zero', () => {
    expect(usage(4, 0, 0)).toBe('4 real model calls · tokens not reported');
  });

  it('shows the numbers once the provider reports any usage', () => {
    expect(usage(2, 0, 7)).toBe('2 real model calls · 0 input / 7 output tokens');
  });
});

describe('entry readiness for the model provider', () => {
  it('says configured, and that this is not a connectivity check, until a real request has run', () => {
    for (const connectivity of [null, undefined, 'unverified', 'not-applicable'] as const) {
      const view = modelReadiness(true, connectivity);
      expect(view.label).toBe('Configured');
      expect(view.note).toContain('Configured is not a connectivity check');
      expect(view.note).toContain('Use Verify connection');
      expect(view.failing).toBe(false);
    }
  });

  it('agrees with the header badge once a real request has succeeded', () => {
    const view = modelReadiness(true, 'ok');
    expect(view.label).toBe('Connected');
    expect(view.note).toContain('A real request has succeeded since the server started');
    expect(view.note).not.toContain('not a connectivity check');
  });

  it('says so when the most recent real request failed', () => {
    const view = modelReadiness(true, 'failing');
    expect(view).toMatchObject({ label: 'Failing', failing: true });
    expect(view.note).toContain('The most recent real request failed');
  });

  it('never claims a connection for an unconfigured provider, whatever the status says', () => {
    for (const connectivity of ['ok', 'failing', null] as const) {
      const view = modelReadiness(false, connectivity);
      expect(view.label).toBe('Not configured');
      expect(view.note).not.toContain('Use Verify connection');
      expect(view.failing).toBe(false);
    }
  });
});
