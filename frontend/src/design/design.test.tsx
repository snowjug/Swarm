import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cx } from './cx';
import { MOTION_PREFERENCES, parseMotionPreference } from './motion';
import { SPRING, stagger } from './motion/tokens';
import {
  Button,
  Chip,
  ChipButton,
  Disclosure,
  Field,
  IconButton,
  Input,
  Meter,
  Notice,
  Orbit,
  Ring,
  Segmented,
  Skeleton,
  Switch,
  TooltipProvider,
} from './ui';

// What every screen is built from has to be right once: a name for every control, a role for every state, and
// nothing that depends on colour or on a pointer alone.

const html = (node: React.ReactElement): string =>
  renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

describe('class names', () => {
  it('joins what is a string and leaves out the rest', () => {
    expect(cx('a', false, undefined, null, '', 'b', 3)).toBe('a b');
  });
});

describe('motion', () => {
  it('takes only a known preference from storage', () => {
    for (const name of MOTION_PREFERENCES) expect(parseMotionPreference(name)).toBe(name);
    for (const bad of [null, undefined, '', 'fast', 1, {}])
      expect(parseMotionPreference(bad)).toBe('system');
  });

  it('staggers a group by short steps and never makes a long list wait', () => {
    expect(stagger(0)).toBe(0);
    expect(stagger(3)).toBeCloseTo(0.12);
    expect(stagger(500)).toBeLessThanOrEqual(0.36);
    expect(stagger(-4)).toBe(0);
  });

  it('has springs that are damped: none is under-damped past the point of looking unsteady', () => {
    for (const spring of Object.values(SPRING)) {
      const ratio = spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
      expect(ratio).toBeGreaterThan(0.5);
    }
  });
});

describe('buttons', () => {
  it('says that it is working, and cannot be pressed again, without losing its name', () => {
    const markup = html(
      <Button busy busyLabel="Starting">
        Run
      </Button>,
    );
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled');
    expect(markup).toContain('Run');
    expect(markup).toContain('Starting');
  });

  it('names an icon button and says whether a toggle is on', () => {
    const markup = html(
      <IconButton label="Pause" pressed>
        <svg />
      </IconButton>,
    );
    expect(markup).toContain('aria-label="Pause"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('is a real button by default and never a submit by accident', () => {
    expect(html(<Button>Go</Button>)).toContain('type="button"');
    expect(html(<ChipButton pressed>Filter</ChipButton>)).toContain('aria-pressed="true"');
  });
});

describe('choosing', () => {
  it('is a radio group in which one option is checked and only it is in the tab order', () => {
    const markup = html(
      <Segmented
        label="Show"
        value="b"
        onChange={() => undefined}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Show"');
    expect(markup.match(/aria-checked="true"/gu)).toHaveLength(1);
    expect(markup.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(markup.match(/tabindex="-1"/gu)).toHaveLength(1);
  });

  it('is a switch, a real checkbox underneath, with its words attached', () => {
    const markup = html(
      <Switch label="Sensitivity" description="Moves one at a time" defaultChecked />,
    );
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Moves one at a time');
  });
});

describe('what a field says', () => {
  it('wires the label, the hint and the error to the control, so that a screen reader reads them with it', () => {
    const markup = html(
      <Field label="Name" hint="As it should appear" error="Give it a name.">
        <Input defaultValue="" />
      </Field>,
    );
    expect(markup).toContain('<label');
    expect(markup).toContain('aria-invalid="true"');
    const describedBy = /aria-describedby="([^"]+)"/u.exec(markup)?.[1]?.split(' ') ?? [];
    expect(describedBy).toHaveLength(2);
    for (const id of describedBy) expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain('role="alert"');
  });
});

describe('what a state says', () => {
  it('reads a value as a number, not as a colour', () => {
    const meter = html(<Meter value={0.4} label="Adoption" valueText="40%" />);
    expect(meter).toContain('role="meter"');
    expect(meter).toContain('aria-valuenow="0.4"');
    expect(meter).toContain('aria-valuetext="40%"');
    const ring = html(
      <Ring value={0.5} label="Progress" valueText="5 of 10">
        5
      </Ring>,
    );
    expect(ring).toContain('role="progressbar"');
    expect(ring).toContain('aria-valuenow="50"');
  });

  it('announces a failure at once and everything else politely', () => {
    expect(html(<Notice tone="error">It failed.</Notice>)).toContain('role="alert"');
    expect(html(<Notice tone="info">Note.</Notice>)).toContain('role="status"');
  });

  it('gives a loader a name and hides a placeholder shape from a screen reader', () => {
    expect(html(<Orbit label="Reading" />)).toContain('Reading');
    expect(html(<Skeleton />)).toContain('aria-hidden="true"');
  });

  it('keeps a closed disclosure in the document but out of the way: inert, and not read as open', () => {
    const closed = html(<Disclosure summary="Method">Text that is there.</Disclosure>);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('inert');
    expect(closed).toContain('Text that is there.');
    const open = html(
      <Disclosure summary="Method" defaultOpen>
        Text.
      </Disclosure>,
    );
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain('inert');
  });

  it('is text first: a chip with a dot still says its word', () => {
    expect(
      html(
        <Chip tone="against" dot>
          Harmed
        </Chip>,
      ),
    ).toContain('Harmed');
  });
});
