import { useCallback, useLayoutEffect, useRef } from 'react';

const BOTTOM_THRESHOLD_PX = 48;
const SCROLL_TOLERANCE_PX = 1;

interface ScrollPosition {
  top: number;
  contentHeight: number;
  viewportHeight: number;
}

function readPosition(element: HTMLDivElement): ScrollPosition {
  const contentHeight = element.scrollHeight;
  const viewportHeight = element.clientHeight;
  // Safari can report positions outside the scroll range during elastic overscroll.
  const maximumTop = Math.max(0, contentHeight - viewportHeight);
  return {
    top: Math.max(0, Math.min(element.scrollTop, maximumTop)),
    contentHeight,
    viewportHeight,
  };
}

function isNearBottom(position: ScrollPosition) {
  return position.contentHeight - position.viewportHeight - position.top <= BOTTOM_THRESHOLD_PX;
}

/** Follow new content until the reader deliberately scrolls upward. */
export function useConversationScroll(conversationId: string | null) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastPosition = useRef<ScrollPosition | undefined>(undefined);
  const scheduleScroll = useRef<() => void>(() => {});

  const scrollToLatest = useCallback(() => {
    following.current = true;
    scheduleScroll.current();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    let frame: number | undefined;
    let touchY: number | undefined;

    function followBottom() {
      if (!following.current || !viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
      lastPosition.current = readPosition(viewport);
    }

    function schedule() {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        followBottom();
      });
    }

    function pauseFollowing() {
      // Scrolling upward in a conversation that fits on screen cannot reveal older content.
      if (viewport && viewport.scrollHeight > viewport.clientHeight) following.current = false;
    }

    function onScroll() {
      if (!viewport) return;
      const current = readPosition(viewport);
      const previous = lastPosition.current;
      lastPosition.current = current;
      if (!previous) return;

      const movedDown = current.top > previous.top + SCROLL_TOLERANCE_PX;
      if (movedDown && isNearBottom(current)) {
        following.current = true;
        schedule();
        return;
      }

      const layoutChanged =
        current.contentHeight !== previous.contentHeight ||
        current.viewportHeight !== previous.viewportHeight;
      if (layoutChanged) {
        // Content growth and viewport resizing are not requests to stop following.
        if (following.current) schedule();
        return;
      }

      if (current.top < previous.top - SCROLL_TOLERANCE_PX) {
        following.current = false;
      }
    }

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && event.deltaY < 0) pauseFollowing();
    }

    function onTouchStart(event: TouchEvent) {
      touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
    }

    function onTouchMove(event: TouchEvent) {
      const nextY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
      if (touchY !== undefined && nextY !== undefined && nextY - touchY > 4) pauseFollowing();
      touchY = nextY;
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      const movesUp =
        ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
        (event.key === ' ' && event.shiftKey && target === viewport);
      if (movesUp) pauseFollowing();
    }

    scheduleScroll.current = schedule;
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('wheel', onWheel, { passive: true });
    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: true });
    viewport.addEventListener('keydown', onKeyDown);

    // Observe the content as well as the viewport: images, fonts, activity panels and
    // composer/sidebar resizing can change the bottom without a new model message.
    const observer = new ResizeObserver(followBottom);
    observer.observe(content);
    observer.observe(viewport);
    followBottom();

    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      scheduleScroll.current = () => {};
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useLayoutEffect(() => {
    // A new/reopened conversation always starts at the latest content, even if the
    // previous conversation was paused while reading older messages.
    following.current = true;
    lastPosition.current = undefined;
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
      lastPosition.current = readPosition(viewport);
    }
    scheduleScroll.current();
  }, [conversationId]);

  return { viewportRef, contentRef, scrollToLatest };
}
