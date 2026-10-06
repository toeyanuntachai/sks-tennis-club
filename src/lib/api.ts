export type Member = { id: string; nickname: string | null };
export type Participant = { id: string; nickname: string; paid: boolean; isGuest: boolean };
export type ClubEvent = {
  id: string; title: string; venue: string; date: string; start: string; end: string;
  courts: number; courtNames: string; capacity: number; cancelled: boolean;
  organizerName: string; isOrganizer: boolean; confirmed: number; waiting: number; myPosition: number | null;
};
export type EventDetail = ClubEvent & {
  courtCostSatang: number | null; ballCostSatang: number | null; totalCostSatang: number | null;
  sharePeople: number; sharePerPersonSatang: number | null; roundingSurplusSatang: number | null;
  hasPaymentQr: boolean; participants: Participant[]; waitlist: Participant[]; withdrawn: Participant[];
  dateLocked?: boolean;
};
export type EventFields = Pick<ClubEvent, 'title' | 'venue' | 'date' | 'start' | 'end' | 'courts' | 'courtNames' | 'capacity'> & {
  courtCostSatang: number | null; ballCostSatang: number | null; paymentQr?: string | null;
};
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.message || 'โหลดข้อมูลไม่สำเร็จ', response.status, result.code);
  return result;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่';
export const eventPath = (id: string) => '/events/' + encodeURIComponent(id);
export const paymentQrUrl = (id: string) => '/api' + eventPath(id) + '/payment-qr';
export const money = (satang: number) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(satang / 100);
export const dateLabel = (date: string) => new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(date + 'T12:00:00'));
export type ClubMatch = {
  id: string; teamA: Member[]; teamB: Member[]; scoreA: number; scoreB: number;
  createdBy: Member; updatedBy: Member; createdAt: number; updatedAt: number;
  version: number; voided: boolean; canEdit: boolean;
};
export type MatchDetail = { matches: ClubMatch[]; players: Member[]; canRecord: boolean };
export type Standing = { id: string; nickname: string; rank: number; points: number; played: number; wins: number; draws: number; losses: number; winPercent: number };
export type RankingDetail = { month: string; months: string[]; standings: Standing[]; mine: Standing | null };
export function currentMonth() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month;
}
export const monthLabel = (month: string) => new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(month + '-01T12:00:00+07:00'));
