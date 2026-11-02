import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Download,
  FileText,
  History,
  Layers,
  Play,
  Search,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  Button,
  Chip,
  ChipButton,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  Input,
  Mark,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Meter,
  Notice,
  Orbit,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Ring,
  Segmented,
  Select,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
  Skeleton,
  SkeletonText,
  Slider,
  Stat,
  Switch,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
} from './ui';
import { Aurora } from './ambient';
import { SwarmField } from './ambient/SwarmField';
import {
  MOTION_LABELS,
  MOTION_PREFERENCES,
  setMotionPreference,
  useMotionPreference,
} from './motion';

const THEMES = ['light', 'dark', 'high-contrast'] as const;
const SCENES = ['ask', 'ground', 'map', 'simulate', 'compare', 'decide'] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="gallery-section">
      <h2 className="sw-eyebrow">{title}</h2>
      <div className="gallery-row">{children}</div>
    </section>
  );
}

/** Development only: every primitive in every state, for looking at, in each theme and motion setting. */
export function Gallery() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>(
    () => (document.documentElement.dataset.theme as (typeof THEMES)[number]) ?? 'light',
  );
  const [scene, setScene] = useState<(typeof SCENES)[number]>('ask');
  const motionPreference = useMotionPreference();
  const toast = useToast();
  const [view, setView] = useState<'story' | 'live' | 'network'>('live');
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('b');
  const [slider, setSlider] = useState(0.42);
  const [stance, setStance] = useState(-0.3);
  const [pressed, setPressed] = useState(true);
  const [value, setValue] = useState(128);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="gallery" data-scene={scene}>
      <Aurora />
      <div className="gallery-inner">
        <header className="gallery-head">
          <div className="gallery-brand">
            <Mark size={32} title="Swarm" />
            <span className="sw-heading">Swarm design gallery</span>
          </div>
          <div className="gallery-controls">
            <Segmented
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={THEMES.map((name) => ({ value: name, label: name }))}
              size="sm"
            />
            <Segmented
              label="Scene tint"
              value={scene}
              onChange={setScene}
              options={SCENES.map((name) => ({ value: name, label: name }))}
              size="sm"
            />
            <Segmented
              label="Motion"
              value={motionPreference}
              onChange={setMotionPreference}
              options={MOTION_PREFERENCES.map((name) => ({
                value: name,
                label: MOTION_LABELS[name],
              }))}
              size="sm"
            />
          </div>
        </header>

        <section className="gallery-hero" ref={anchor}>
          <SwarmField anchor={anchor} gather={pressed} />
          <p className="sw-eyebrow">Explore</p>
          <h1 className="sw-hero">
            What could <em>happen</em> next?
          </h1>
          <p className="sw-lead">Type scale: hero, display, title, lead, read, caption.</p>
          <div className="gallery-row">
            <Button
              variant="primary"
              size="lg"
              iconEnd={<ArrowRight size={18} />}
              onClick={() => setPressed(!pressed)}
            >
              {pressed ? 'Release the swarm' : 'Gather the swarm'}
            </Button>
          </div>
        </section>

        <Section title="Type">
          <div className="gallery-stack">
            <div className="sw-display">
              Display serif, <em>with italics</em>
            </div>
            <div className="sw-title">A title in the serif, for a section</div>
            <div className="sw-heading">A heading in the grotesque</div>
            <p className="sw-lead">
              A lead paragraph sets the scene in a calm, slightly larger size.
            </p>
            <p className="sw-read">
              Reading text is seventeen pixels on a generous line, held to a comfortable measure so
              that long passages of a brief can be read without effort. Numbers such as{' '}
              <span className="num">0.42</span> and <span className="num">1,204</span> keep their
              width.
            </p>
            <p className="sw-caption">A caption: small, quiet, never below twelve pixels.</p>
            <p className="sw-mono">mono · seed 42 · S3 · agent-7</p>
          </div>
        </Section>

        <Section title="Buttons">
          <Button variant="primary" icon={<Sparkles size={16} />}>
            Primary
          </Button>
          <Button variant="accent" icon={<Play size={16} />}>
            Run simulation
          </Button>
          <Button variant="glass" icon={<Download size={16} />}>
            Glass
          </Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Remove</Button>
          <Button variant="primary" busy busyLabel="Reading your question">
            Reading
          </Button>
          <Button variant="glass" disabled>
            Disabled
          </Button>
          <Button variant="glass" size="sm">
            Small
          </Button>
          <IconButton label="History" shortcut="H" tone="glass">
            <History size={18} />
          </IconButton>
          <IconButton label="Search">
            <Search size={18} />
          </IconButton>
          <IconButton label="Toggle" pressed={pressed} onClick={() => setPressed(!pressed)}>
            <Layers size={18} />
          </IconButton>
        </Section>

        <Section title="Chips">
          <Chip>Neutral</Chip>
          <Chip tone="accent" dot>
            Accent
          </Chip>
          <Chip tone="against" dot>
            Against
          </Chip>
          <Chip tone="favor" dot>
            In favour
          </Chip>
          <Chip tone="caution" dot>
            Caution
          </Chip>
          <Chip tone="critical" dot>
            Blocking
          </Chip>
          <ChipButton
            pressed={pressed}
            onClick={() => setPressed(!pressed)}
            icon={<Users size={14} />}
          >
            Filter
          </ChipButton>
          <ChipButton>Not pressed</ChipButton>
        </Section>

        <Section title="Choice">
          <Segmented
            label="Pick one"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'a', label: '10' },
              { value: 'b', label: '30' },
              { value: 'c', label: '100' },
            ]}
          />
          <Tabs
            value={view}
            onValueChange={setView}
            label="Views"
            variant="pill"
            tabs={[
              { value: 'story', label: 'Story' },
              { value: 'live', label: 'Live' },
              { value: 'network', label: 'Network', count: 22 },
            ]}
          >
            <TabPanel value="story">
              <p className="sw-caption">Story panel</p>
            </TabPanel>
            <TabPanel value="live">
              <p className="sw-caption">Live panel</p>
            </TabPanel>
            <TabPanel value="network">
              <p className="sw-caption">Network panel</p>
            </TabPanel>
          </Tabs>
          <Tabs
            value={view}
            onValueChange={setView}
            label="Views (line)"
            tabs={[
              { value: 'story', label: 'Story' },
              { value: 'live', label: 'Live' },
              { value: 'network', label: 'Network' },
            ]}
          />
        </Section>

        <Section title="Fields">
          <div className="gallery-fields">
            <Field label="Project name" hint="Optional. Defaults to the start of your question.">
              <Input placeholder="Pricing in Europe" />
            </Field>
            <Field label="Seed" error="Choose a whole number from 1 to 2,147,483,647.">
              <Input defaultValue="0" inputMode="numeric" />
            </Field>
            <Field label="Mode">
              <Select defaultValue="local">
                <option value="local">Local rules</option>
                <option value="llm">Model assisted</option>
              </Select>
            </Field>
            <Field label="Question">
              <Textarea
                placeholder="What could happen if…"
                defaultValue="What could happen if we raise prices by eight percent in Europe next quarter, with a short notice?"
              />
            </Field>
          </div>
          <div className="gallery-stack">
            <Switch
              label="Test sensitivity"
              description="Moves one assumption at a time."
              defaultChecked
            />
            <Switch label="Reduce motion" />
            <div className="gallery-slider">
              <Slider
                label="Intensity"
                value={slider}
                onValueChange={setSlider}
                valueText={`${Math.round(slider * 100)} percent`}
              />
              <span className="num">{slider.toFixed(2)}</span>
            </div>
            <div className="gallery-slider">
              <Slider
                label="Stance"
                diverging
                min={-1}
                max={1}
                value={stance}
                onValueChange={setStance}
              />
              <span className="num">{stance.toFixed(2)}</span>
            </div>
          </div>
        </Section>

        <Section title="Surfaces">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="glass" icon={<Settings2 size={16} />}>
                Popover
              </Button>
            </PopoverTrigger>
            <PopoverContent width="20rem">
              <div className="gallery-stack">
                <h3 className="sw-heading">Run settings</h3>
                <Switch label="Model assisted" />
                <Field label="Actors">
                  <Input defaultValue="12" />
                </Field>
              </div>
            </PopoverContent>
          </Popover>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="glass">Menu</Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Project</MenuLabel>
              <MenuItem icon={<FileText size={16} />} shortcut="E">
                Export brief
              </MenuItem>
              <MenuItem icon={<Bell size={16} />}>Notifications</MenuItem>
              <MenuSeparator />
              <MenuItem tone="danger">Delete</MenuItem>
            </MenuContent>
          </Menu>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="glass" icon={<History size={16} />}>
                Sheet
              </Button>
            </SheetTrigger>
            <SheetContent
              eyebrow="History"
              title="Your explorations"
              description="Everything you have asked, newest first."
              footer={
                <SheetClose asChild>
                  <Button variant="primary">Done</Button>
                </SheetClose>
              }
            >
              <SkeletonText lines={5} />
            </SheetContent>
          </Sheet>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="glass">Dialog</Button>
            </DialogTrigger>
            <DialogContent
              title="Replace the reviewed list?"
              description="Finding stakeholders again replaces the list you reviewed."
              footer={
                <>
                  <DialogClose asChild>
                    <Button variant="ghost">Keep it</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="danger">Replace</Button>
                  </DialogClose>
                </>
              }
            />
          </Dialog>
          <Button
            variant="glass"
            onClick={() =>
              toast({
                title: 'Brief written',
                description: 'It rests on 30 runs of each scenario.',
                tone: 'success',
              })
            }
          >
            Toast ok
          </Button>
          <Button
            variant="glass"
            onClick={() =>
              toast({
                title: 'Could not reach the server',
                description: 'Nothing was lost.',
                tone: 'error',
                action: { label: 'Retry', onPress: () => undefined },
              })
            }
          >
            Toast error
          </Button>
        </Section>

        <Section title="Progress and state">
          <Ring value={0.64} size={72} label="Runs" valueText="64 percent">
            <span className="num">64%</span>
          </Ring>
          <Ring value={0.2} size={48} label="Sensitivity" tone="favor" />
          <div className="gallery-stack" style={{ width: '14rem' }}>
            <Meter value={0.7} label="Influence" valueText="70 percent" />
            <Meter value={0.3} label="Risk" tone="against" />
            <Meter value={0.5} label="Support" tone="favor" size="sm" />
          </div>
          <Orbit size={28} label="Working" />
          <Stat value={value} label="Simulated runs" />
          <Stat value={63} suffix="%" label="Look for an alternative" tone="against" size="sm" />
          <Button variant="glass" size="sm" onClick={() => setValue(value === 128 ? 1201 : 128)}>
            Change number
          </Button>
        </Section>

        <Section title="Placeholders and notices">
          <div className="gallery-stack" style={{ width: '24rem' }}>
            <Skeleton height="2rem" width="60%" />
            <SkeletonText lines={3} />
          </div>
          <div className="gallery-stack" style={{ width: '28rem' }}>
            <Notice tone="info" title="Read by rules">
              Your question did not leave this machine.
            </Notice>
            <Notice tone="caution" title="Out of date">
              The stakeholders changed after this was run.
            </Notice>
            <Notice
              tone="error"
              title="Could not save"
              action={
                <Button size="sm" variant="glass">
                  Retry
                </Button>
              }
            >
              Your changes are still here.
            </Notice>
            <Notice tone="success" title="Approved">
              Twenty-two actors were made.
            </Notice>
          </div>
          <EmptyState
            icon={<Sparkles size={22} />}
            title="Nothing here yet"
            action={
              <Button variant="primary" size="sm">
                Begin
              </Button>
            }
          >
            Ask a question and it will appear here.
          </EmptyState>
        </Section>

        <Section title="Disclosure">
          <div className="gallery-stack" style={{ width: '28rem' }}>
            <Disclosure summary="Method">
              <p className="sw-caption" style={{ padding: '0.5rem 0 1rem' }}>
                Outcomes are a mechanical consequence of the declared assumptions. Repeatability
                describes the simulator’s own randomness, not how likely anything is in the world.
              </p>
            </Disclosure>
            <hr className="sw-rule" />
            <Disclosure summary="Sources" tone="strong">
              <p className="sw-caption" style={{ padding: '0.5rem 0 1rem' }}>
                Five synthetic documents.
              </p>
            </Disclosure>
          </div>
        </Section>

        <Section title="Glass">
          <div className="gallery-glass">
            <div className="sw-glass" style={{ padding: '1.25rem', width: '14rem' }}>
              Glass
            </div>
            <div
              className="sw-glass sw-glass--raised"
              style={{ padding: '1.25rem', width: '14rem' }}
            >
              Raised
            </div>
            <div
              className="sw-glass sw-glass--overlay"
              style={{ padding: '1.25rem', width: '14rem' }}
            >
              Overlay
            </div>
            <div className="sw-glass sw-glass--lit" style={{ padding: '1.25rem', width: '14rem' }}>
              Lit
            </div>
          </div>
          <div className="gallery-swatches">
            {[
              '--c-against',
              '--c-favor',
              '--c-neutral',
              '--c-caution',
              '--c-critical',
              '--accent',
              '--cat-1',
              '--cat-2',
              '--cat-3',
              '--cat-4',
              '--cat-5',
              '--cat-6',
              '--cat-7',
              '--cat-8',
            ].map((name) => (
              <span
                key={name}
                className="gallery-swatch"
                style={{ background: `var(${name})` }}
                title={name}
              />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
