export type Child = Node | string | number | null | undefined | false | Child[];

type AttrValue = string | number | boolean | null | undefined;
type Handlers = { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };

export interface Props {
  class?: string;
  attrs?: Record<string, AttrValue>;
  dataset?: Record<string, string>;
  on?: Handlers;
}

/**
 * Create an element. Strings always become text nodes, so course data can never
 * be parsed as HTML; the app has no innerHTML anywhere.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (/^on/i.test(name)) throw new Error(`Use props.on for "${name}", not an attribute`);
    // ARIA states are strings ("true"/"false"), not HTML boolean attributes
    if (name.startsWith("aria-") && typeof value === "boolean") {
      el.setAttribute(name, String(value));
      continue;
    }
    if (value === false || value == null) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
  if (props.dataset) Object.assign(el.dataset, props.dataset);
  for (const [type, handler] of Object.entries(props.on ?? {})) {
    if (handler) el.addEventListener(type, handler as EventListener);
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (typeof child === "string" || typeof child === "number") parent.appendChild(document.createTextNode(String(child)));
    else parent.appendChild(child);
  }
}

/** replaceChildren() that accepts the same children as h(), including null/false/arrays. */
export function setChildren(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** True when the user is typing, so single-key shortcuts should be ignored. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
