import { api, type Member } from './lib/api';

type Liff = {
  init(options: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(options: { redirectUri: string }): void;
  getIDToken(): string | null;
  isApiAvailable(name: string): boolean;
  shareTargetPicker(messages: { type: 'text'; text: string }[]): Promise<unknown>;
};
declare global { interface Window { liff?: Liff } }
export type Config = { ready: boolean; liffId: string };

// One session instance per mounted app; SDK redirect sequencing stays here.
export function lineSession() {
  let ready: Promise<void> | undefined;
  let invite = new URLSearchParams(location.search).get('invite') || '';
  let requestedEvent = new URLSearchParams(location.search).get('event');
  async function initialize(config: Config) {
    const liff = window.liff;
    if (!liff) throw new Error('โหลด LINE ไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่');
    await (ready ||= liff.init({ liffId: config.liffId }).then(() => {
      // LIFF may normalize the URL during init: read invite/event again afterwards.
      const query = new URLSearchParams(location.search);
      invite = query.get('invite') || invite;
      requestedEvent = query.get('event') || requestedEvent;
    }).catch(error => { ready = undefined; throw error; }));
    return liff;
  }
  return {
    initialize,
    takeEvent() { const id = requestedEvent; requestedEvent = null; return id; },
    async login(config: Config) {
      const liff = await initialize(config);
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return null; }
      const idToken = liff.getIDToken();
      if (!idToken) throw new Error('เข้าใช้งาน LINE ไม่สำเร็จ กรุณาลองใหม่');
      const result = await api<{ member: Member; suggestedNickname: string }>('/auth', 'POST', { idToken, invite });
      invite = '';
      const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState(null, '', url);
      return result;
    },
    async share(config: Config, text: string) {
      if (window.liff) {
        const liff = await initialize(config);
        if (liff.isApiAvailable('shareTargetPicker') && liff.isLoggedIn()) {
          return await liff.shareTargetPicker([{ type: 'text', text }]) ? 'shared' : 'cancelled';
        }
      }
      try { await navigator.clipboard.writeText(text); return 'copied'; }
      catch { return 'manual'; }
    },
  };
}
export type LineSession = ReturnType<typeof lineSession>;
