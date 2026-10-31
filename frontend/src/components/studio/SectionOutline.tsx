import { SECTION_ORIGIN_LABELS, type StudioSectionView } from '../../../../shared/studio';
import { sectionFlags } from '../../lib/studio';

/** The report's sections in order, each with what a reader should know before opening it. */
export function SectionOutline({
  sections,
  selected,
  onSelect,
}: {
  sections: readonly StudioSectionView[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="studio-outline" aria-label="Report sections">
      <ol>
        {sections.map((section) => {
          const flags = sectionFlags(section);
          return (
            <li key={section.id}>
              <button
                type="button"
                className="studio-outline-item"
                aria-current={selected === section.id ? 'true' : undefined}
                onClick={() => onSelect(section.id)}
              >
                <strong>{section.title}</strong>
                <small>
                  {SECTION_ORIGIN_LABELS[section.origin]}, version {section.version}
                </small>
                {flags.length > 0 && <small>{flags.join('; ')}</small>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
