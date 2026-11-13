/**
 * HTML shown in previews is untrusted (it comes from the user's own input, a
 * pasted document, a decoded token...).  It is reduced to inert markup before
 * it reaches the DOM: no scripts, no embedded documents, no network loads and
 * no navigable links.
 */
import DOMPurify from 'dompurify';

const purifier = DOMPurify(window);

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;
  // Links are displayed but can never take the app away from itself.
  if (node.hasAttribute('href')) {
    node.setAttribute('data-href', node.getAttribute('href') ?? '');
    node.setAttribute('title', node.getAttribute('href') ?? '');
    node.removeAttribute('href');
  }
  // Anything that would fetch from the network is dropped; only embedded data survives.
  for (const attribute of ['src', 'srcset', 'poster', 'background']) {
    const value = node.getAttribute(attribute);
    if (value !== null && !/^(data:image\/|blob:)/i.test(value.trim())) {
      node.removeAttribute(attribute);
      if (node.tagName === 'IMG' && !node.getAttribute('alt')) node.setAttribute('alt', 'image');
      node.setAttribute('data-blocked-source', value.slice(0, 200));
    }
  }
});

export function sanitizeHtml(html: string): string {
  return purifier.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'frame', 'object', 'embed', 'video', 'audio', 'source', 'track', 'form', 'link', 'meta', 'base', 'dialog'],
    FORBID_ATTR: ['action', 'formaction', 'ping', 'autofocus'],
    ALLOW_DATA_ATTR: false,
  });
}
