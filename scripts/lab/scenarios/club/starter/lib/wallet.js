// Members' prepaid balances. Every change is a ledger entry {at, member, amount, kind, ref}
// (kind: 'credit' | 'booking' | 'lesson' | 'shop' | 'refund' | ...); reports read the ledger.
export function createWallet(store) {
  const members = () => store.list('members');
  const ledger = () => store.list('ledger');
  const find = (id) => members().find((m) => m.id === id);
  function move(memberId, amount, kind, ref) {
    const m = find(memberId);
    if (!m) throw new Error('no such member');
    m.balance = Math.round((m.balance + amount) * 100) / 100;
    ledger().push({ at: new Date().toISOString(), member: memberId, amount, kind, ref: ref ?? null });
    store.save('members'); store.save('ledger');
    return m.balance;
  }
  return {
    balance: (id) => find(id)?.balance ?? 0,
    // take money for something; false (nothing taken) if the balance is too low
    charge(id, amount, kind, ref) { if ((find(id)?.balance ?? 0) < amount) return false; move(id, -amount, kind, ref); return true; },
    refund: (id, amount, ref) => move(id, amount, 'refund', ref),
    credit: (id, amount, ref) => move(id, amount, 'credit', ref),
    ledger,
  };
}
