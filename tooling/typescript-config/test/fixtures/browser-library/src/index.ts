/** Appends a labelled button to `parent`. */
export function addButton(parent: HTMLElement, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  parent.append(button);
  return button;
}
