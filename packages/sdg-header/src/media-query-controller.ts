import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** Tracks a media query and re-renders the host when it changes. `matches` is false where matchMedia is missing. */
export class MediaQueryController implements ReactiveController {
  matches = false;
  readonly #host: ReactiveControllerHost;
  readonly #query: string;
  #list: MediaQueryList | undefined;

  constructor(host: ReactiveControllerHost, query: string) {
    this.#host = host;
    this.#query = query;
    host.addController(this);
  }

  hostConnected(): void {
    if (typeof window.matchMedia !== 'function') return;
    this.#list = window.matchMedia(this.#query);
    this.matches = this.#list.matches;
    this.#list.addEventListener('change', this.#onChange);
  }

  hostDisconnected(): void {
    this.#list?.removeEventListener('change', this.#onChange);
    this.#list = undefined;
  }

  readonly #onChange = (event: MediaQueryListEvent): void => {
    this.matches = event.matches;
    this.#host.requestUpdate();
  };
}
