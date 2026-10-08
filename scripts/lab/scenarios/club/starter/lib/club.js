// The club's fixed facts: courts, opening hours, slots and prices (README "Rules").
import { weekday } from './time.js';

export const COURTS = [1, 2, 3, 4].map((n) => ({ id: `c${n}`, name: `Court ${n}` }));
export const OPEN = '08:00', CLOSE = '22:00';
export const SLOTS = Array.from({ length: 14 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);
export const isCourt = (id) => COURTS.some((c) => c.id === id);
export const isSlot = (time) => SLOTS.includes(time);
export function isPeak(date, time) { const d = weekday(date); return d === 'sat' || d === 'sun' || +time.slice(0, 2) >= 18; }
export const price = (date, time, guests = 0) => (isPeak(date, time) ? 20 : 12) + 3 * guests;
