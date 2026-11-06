/**
 * A legal text arrives as plain text. It is shown as text: this reads its lines into headings, lists and paragraphs, and
 * every part of the result is shown by React as a text node. Nothing in it is ever parsed as markup.
 */
export type LegalBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'paragraph'; text: string };

export function legalBlocks(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const closeParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const closeList = () => {
    if (list.length) blocks.push({ kind: 'list', items: list });
    list = [];
  };
  for (const raw of text.replaceAll('\r\n', '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    const item = /^\s*[-*]\s+(.+)$/u.exec(line);
    if (!line.trim()) {
      closeParagraph();
      closeList();
    } else if (heading) {
      closeParagraph();
      closeList();
      blocks.push({
        kind: 'heading',
        level: (heading[1]?.length ?? 1) <= 2 ? 2 : 3,
        text: heading[2] ?? '',
      });
    } else if (item) {
      closeParagraph();
      list.push(item[1] ?? '');
    } else {
      closeList();
      paragraph.push(line.trim());
    }
  }
  closeParagraph();
  closeList();
  return blocks;
}
