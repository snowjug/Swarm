/**
 * Hands a downloaded file to the browser the way the other exports do: an object URL, one click, and
 * the URL released once the browser has taken it.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }
}
