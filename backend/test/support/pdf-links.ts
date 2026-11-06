/**
 * A PDF that holds a line of text and also points at an address in every way a PDF can: a link, an action that runs when
 * the file is opened, a script, a file to launch and a remote destination. A reader that followed any of them would be a
 * way to make a server fetch an address, so a test that extracts the text and sees no request on that address holds that
 * extraction reads the file and nothing more.
 */
export function makeLinkedPdf(text: string, address: string): Buffer {
  const content = `BT /F1 12 Tf 14 TL 50 750 Td\n(${text}) Tj\nET`;
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R /OpenAction 7 0 R /AA << /WC 8 0 R >> /Names << /JavaScript << /Names [(boot) 8 0 R] >> >> >>`,
    '<< /Type /Pages /Count 1 /Kids [4 0 R] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R /Annots [6 0 R 9 0 R 10 0 R] >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    `<< /Type /Annot /Subtype /Link /Rect [50 700 300 720] /Border [0 0 0] /A << /S /URI /URI (${address}/link) >> >>`,
    `<< /S /URI /URI (${address}/open) >>`,
    `<< /S /JavaScript /JS (app.launchURL\\(\\'${address}/script\\', true\\);) >>`,
    '<< /Type /Annot /Subtype /Link /Rect [50 650 300 670] /A << /S /Launch /F (cmd.exe) >> >>',
    `<< /Type /Annot /Subtype /Link /Rect [50 600 300 620] /A << /S /GoToR /F << /Type /Filespec /F (${address}/remote.pdf) /FS /URL >> /D [0 /Fit] >> >>`,
  ];
  let source = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}
