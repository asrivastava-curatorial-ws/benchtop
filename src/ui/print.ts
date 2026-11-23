/**
 * Prints a complete HTML document through the system print dialog (where
 * "Save as PDF" is one of the printers), from a hidden frame so the app
 * itself is not printed.  The desktop app saves PDFs directly instead.
 */
export function printDocument(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.sandbox.add('allow-modals', 'allow-same-origin');
  frame.srcdoc = html;
  frame.addEventListener(
    'load',
    () => {
      const view = frame.contentWindow;
      // Give embedded pictures a moment to decode before the print layout is made.
      setTimeout(() => {
        try {
          view?.focus();
          view?.print();
        } finally {
          setTimeout(() => frame.remove(), 60_000);
        }
      }, 250);
    },
    { once: true },
  );
  document.body.appendChild(frame);
}
