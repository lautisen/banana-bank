import type { PageElement } from "../core/types";

/** A standalone clock like "04:59": countdowns render their digits in their own element. */
const TIMER = /^\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * Generic DOM reader: it knows nothing about the demo shop. It collects text leaves and checkbox
 * labels, which is what a browser extension would see on any third-party checkout.
 */
export function scanDom(root: HTMLElement): PageElement[] {
  const out: PageElement[] = [];
  let i = 0;
  const tag = (el: HTMLElement) => {
    el.dataset.ulisesRef ??= `u${i++}`;
    return el.dataset.ulisesRef;
  };
  root.querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
    const box = label.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (box) out.push({ text: label.textContent ?? "", checked: box.checked, ref: tag(label) });
  });
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.closest("label") || el.childElementCount > 0) return;
    const text = (el.textContent ?? "").trim();
    if (!text) return;
    out.push({ text, isTimer: TIMER.test(text), ref: tag(el) });
  });
  return out;
}
