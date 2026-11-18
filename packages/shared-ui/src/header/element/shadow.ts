/** The shadow host `node` renders in, so outside clicks and focus moves can be checked against the whole header. */
export function hostOf(node: Node | null): Element | null {
  const root = node?.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Whether `node` is in the header: light DOM (slotted content) or its shadow root. */
export function isInside(host: Element | null, node: Node): boolean {
  return host !== null && (host.contains(node) || (host.shadowRoot?.contains(node) ?? false));
}

export function isPlainPrimaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}
