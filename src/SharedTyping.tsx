import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { sharedRequest } from './SharedFiles';

export interface TypingPerson {
  id: string;
  name: string;
}

export function useSharedTyping(id: string | null, remote: boolean, enabled: boolean) {
  const signal = useRef<(active: boolean) => void>(() => {});
  const key = enabled ? `${remote}:${id}` : '';
  const [presence, setPresence] = useState<{ key: string; people: TypingPerson[] }>({
    key: '',
    people: [],
  });
  useEffect(() => {
    if (!id || !enabled) {
      signal.current = () => {};
      return;
    }
    const client = crypto.randomUUID();
    let alive = true,
      active = false,
      lastInput = 0,
      pending: boolean | undefined,
      sending = false,
      loading = false;
    async function report(value: boolean) {
      pending = value;
      if (sending) return;
      sending = true;
      while (pending !== undefined) {
        const active = pending;
        pending = undefined;
        try {
          if (remote) await sharedRequest({ id: id!, remote: true }, 'typing', { client, active });
          else
            await api(`/shared/sessions/${id}/typing`, {
              method: 'POST',
              body: JSON.stringify({ client, active }),
            });
        } catch {
          /* Presence is best-effort and must never interrupt a draft. */
        }
      }
      sending = false;
    }
    signal.current = (value) => {
      lastInput = Date.now();
      if (active === value) return;
      active = value;
      void report(value);
    };
    async function poll() {
      if (remote || loading) return;
      loading = true;
      try {
        const people = await api<TypingPerson[]>(`/shared/sessions/${id}/typing`);
        if (alive) setPresence({ key, people });
      } catch {
        if (alive) setPresence({ key, people: [] });
      } finally {
        loading = false;
      }
    }
    void poll();
    const timer = setInterval(() => {
      if (active) {
        if (Date.now() - lastInput >= 2500) {
          active = false;
          void report(false);
        } else void report(true);
      }
      void poll();
    }, 1500);
    function stop() {
      signal.current(false);
    }
    window.addEventListener('blur', stop);
    function hidden() {
      if (document.hidden) stop();
    }
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
      signal.current = () => {};
      if (active || sending) void report(false);
    };
  }, [id, remote, enabled, key]);
  return {
    people: presence.key === key ? presence.people : [],
    changed: (text: string) => signal.current(!!text.trim()),
    stop: () => signal.current(false),
  };
}

export function TypingIndicator({ people, self }: { people: TypingPerson[]; self: string }) {
  const others = people.filter((person) => person.id !== self);
  const names = others.slice(0, 2).map((person) => person.name);
  const subject =
    others.length > 2 ? `${names.join(', ')} and ${others.length - 2} others` : names.join(' and ');
  const text = others.length ? `${subject} ${others.length === 1 ? 'is' : 'are'} typing…` : '';
  return (
    <div className="shared-typing" role="status" aria-live="polite" aria-atomic="true" title={text}>
      {text}
    </div>
  );
}
