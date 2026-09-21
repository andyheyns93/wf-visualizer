import { useEffect, useRef, useState } from 'react';

/**
 * Track the first element matching `selectors` in the page (light) DOM, re-querying as the
 * DOM mutates — Azure DevOps re-renders its toolbars, so targets come and go. Accepts one
 * selector or a candidate list (tried in order). Pass null to disable.
 */
export function useElement(selectors: string | string[] | null): Element | null {
  const [el, setEl] = useState<Element | null>(null);
  const key = Array.isArray(selectors) ? selectors.join('||') : selectors;

  useEffect(() => {
    if (!key) {
      setEl(null);
      return;
    }
    const list = key.split('||');
    let raf = 0;
    const query = (): Element | null => {
      for (const s of list) {
        const found = document.querySelector(s);
        if (found) return found;
      }
      return null;
    };
    const find = () =>
      setEl((prev) => {
        const next = query();
        return next === prev ? prev : next;
      });
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        find();
      });
    };
    find();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);

  return el;
}

/**
 * Track the trimmed text content of the first element matching `selector` (null to disable).
 * The SPA can swap this text behind the scenes, so we watch DOM mutations *and* poll as a
 * backstop, since a MutationObserver alone can miss/precede some React updates.
 */
export function useElementText(selector: string | null): string | null {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!selector) {
      setText(null);
      return;
    }
    let raf = 0;
    const read = () =>
      setText((prev) => {
        const next = document.querySelector(selector)?.textContent?.trim() || null;
        return prev === next ? prev : next;
      });
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        read();
      });
    };
    read();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(read, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(poll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [selector]);

  return text;
}

/** Track an element's viewport rect, updating on resize/scroll. Null when `el` is null. */
export function useRect(el: Element | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!el) {
      setRect(null);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : r,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const id = window.setInterval(update, 200);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      clearInterval(id);
    };
  }, [el]);

  return rect;
}

/**
 * A React portal target inserted immediately before `anchor`. Uses a single persistent
 * element that is *relocated* (not recreated) when the anchor changes — Azure DevOps
 * re-renders its toolbar on navigation, and recreating the mount would remount the button
 * and make it flicker. Returns the (stable) mount element, or null before it's first placed.
 */
export function useInsertBefore(anchor: Element | null): HTMLElement | null {
  const elRef = useRef<HTMLElement | null>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Only (re)place when there's an anchor; when it's briefly missing (toolbar re-render),
    // leave the element where it is so the button doesn't blink out.
    if (!anchor?.parentNode) return;
    if (!elRef.current) {
      const el = document.createElement('span');
      el.className = 'wf-ext-toolbar-mount';
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      elRef.current = el;
    }
    const el = elRef.current;
    if (anchor.previousElementSibling !== el) {
      anchor.parentNode.insertBefore(el, anchor);
    }
    setMount(el);
  }, [anchor]);

  // Remove the persistent element only when the hook unmounts.
  useEffect(
    () => () => {
      elRef.current?.remove();
      elRef.current = null;
    },
    [],
  );

  return mount;
}
