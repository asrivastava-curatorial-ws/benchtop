/**
 * Props for a scrolling area that holds no controls of its own: a preview, a
 * report, a table of results.  Keyboard users reach it with Tab and scroll it
 * with the arrow keys; screen readers announce it by name.  Put it on the
 * scrolling element itself, or on its only child when a parent scrolls.
 */
export function scrollRegion(label: string) {
  return { tabIndex: 0, role: 'region', 'aria-label': label } as const;
}
