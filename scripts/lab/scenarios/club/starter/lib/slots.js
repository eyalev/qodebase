// Who has each court slot. Modules that take slots register an occupant:
//   app.slots.occupant((date) => [{ court, time, status: 'taken' | 'blocked', kind, ref }])
// and everyone asks app.slots.status(date, court, time) -> 'free' | 'taken' | 'blocked'.
import { COURTS, SLOTS, price } from './club.js';

export function createSlots() {
  const occupants = [];
  const taken = (date) => occupants.flatMap((fn) => fn(date) || []);
  return {
    occupant(fn) { occupants.push(fn); },
    taken,
    status(date, court, time) { const t = taken(date).find((x) => x.court === court && x.time === time); return t ? t.status : 'free'; },
    // the day's grid, as GET /api/availability returns it
    day(date) {
      const busy = taken(date);
      return COURTS.flatMap((c) => SLOTS.map((time) => {
        const t = busy.find((x) => x.court === c.id && x.time === time);
        return { court: c.id, time, status: t ? t.status : 'free', price: price(date, time) };
      }));
    },
  };
}
