export interface NavigationState {
  active: string | null;
  remote: string | null;
  sidebarOpen: boolean;
  tab: 'chats' | 'shared';
}
export const NAVIGATION_KEY = 'pi-chat-navigation';
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function readNavigation(
  storage: Pick<Storage, 'getItem'>,
  wide: boolean,
): NavigationState & { hasSavedTab: boolean } {
  function get(key: string) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }
  let saved: Record<string, unknown> = {};
  try {
    const value = JSON.parse(get(NAVIGATION_KEY) ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value) && value.version === 1)
      saved = value;
  } catch {
    /* Preserve the legacy active chat even if layout storage is damaged. */
  }
  const active = get('pi-chat-active');
  const remote = validId(saved.remote) ? saved.remote : null;
  const hasSavedTab = saved.tab === 'chats' || saved.tab === 'shared';
  return {
    active: validId(active) ? active : null,
    remote,
    sidebarOpen: typeof saved.sidebarOpen === 'boolean' ? saved.sidebarOpen : wide,
    tab: remote || saved.tab === 'shared' ? 'shared' : 'chats',
    hasSavedTab,
  };
}
export function loadNavigation(wide: boolean) {
  try {
    return readNavigation(localStorage, wide);
  } catch {
    return readNavigation({ getItem: () => null }, wide);
  }
}
export function saveNavigation(
  state: NavigationState,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
) {
  try {
    const target = storage ?? localStorage;
    if (state.active) target.setItem('pi-chat-active', state.active);
    else target.removeItem('pi-chat-active');
    target.setItem(
      NAVIGATION_KEY,
      JSON.stringify({
        version: 1,
        sidebarOpen: state.sidebarOpen,
        tab: state.tab,
        remote: state.remote,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
