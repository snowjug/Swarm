import { format } from 'prettier';
import { packTableMarkdown, packTableRows } from './pack-table.js';

// Prints the table of what reading the text finds on each example, as docs/stakeholders.md holds it.
// Paste it over the table under "What it finds on the examples".
console.log(
  (await format(packTableMarkdown(await packTableRows()), { parser: 'markdown' })).trimEnd(),
);
