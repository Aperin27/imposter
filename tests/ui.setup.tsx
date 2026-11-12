import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no native dialog implementation; real focus trapping is checked in the browser.
HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) {
  this.setAttribute('open', '');
  const target = this.querySelector<HTMLElement>('[autofocus], button');
  target?.focus();
});
HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute('open'); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });
