/** The few things the public page does to the browser's address, in one place so that a test can watch them. */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
  reload(): void {
    window.location.reload();
  },
};
