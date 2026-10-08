# Clube de Padel da Vila

The app for a small padel club in Lisbon with 4 courts: members book courts and lessons
from their phones, pay from a prepaid balance, wait for full slots, sign up for
tournaments and buy from the pro-shop; the staff run the club, the shop and their own
work rota from an admin area.

**What exists:** the foundations (below): storage, members and sign-in, courts, slots,
prices, the wallet, notifications, the page layout and the module loader. **What to
build:** the features listed under "Modules", each as its own file in `modules/`.

## Stack (fixed)

- Node 22, **no dependencies** (built-in modules only). `node server.js` starts it on
  `PORT` (default 3000). Pages are rendered on the server and work without JavaScript.
- Data in JSON files under `DATA_DIR` (default `./data`); it survives a restart.
- Staff: HTTP basic auth on `/admin*` pages and `/api/admin/*`, user `admin`, password
  `ADMIN_PASSWORD` (default `admin`). Members: `POST /api/login` gives a token for
  `Authorization: Bearer <token>`; the `/login` form sets a `session` cookie.
- Tests: `node --test` (`test/helpers.js` starts the app in-process on a free port).
- Money in euros (numbers like `12.5`), shown as `€12.50`. Lisbon local time: dates
  `YYYY-MM-DD`, times `HH:MM`.

## Foundations (done: keep these interfaces, build on them)

Read `lib/app.js` first: it lists everything a module gets.

| file | what |
|---|---|
| `server.js` | loads `lib/core.js`, then every `modules/*.js` (`register(app)`), then the fallback pages |
| `lib/app.js` | router (`app.get/post/put/patch/delete`), `app.json/html/text/redirect`, `app.needMember`, `app.needStaff`, `app.notify(memberId, text)`, `app.nav(link)`, `app.page(...)` |
| `lib/core.js` | `POST /api/members`, `POST /api/login`, `GET /api/me`, `GET /api/courts`, `GET /api/availability?date=`, `/login`, `/signup`, `/logout` (and `/pt/...`), placeholder `/` and `/pt` |
| `lib/club.js` | `COURTS` (`c1`..`c4`), `SLOTS` (08:00..21:00, 1 hour each), `isPeak`, `price(date, time, guests)` |
| `lib/slots.js` | `app.slots.occupant(fn)`: a module that takes court slots registers `fn(date) -> [{court, time, status: "taken"|"blocked", kind, ref}]`; `app.slots.status(date, court, time)`; `app.slots.day(date)` (what `/api/availability` returns) |
| `lib/wallet.js` | `app.wallet.charge(memberId, amount, kind, ref)` (false if the balance is too low), `refund`, `credit`, `balance`, `ledger()` (every money movement) |
| `lib/store.js` | `app.store.list(name)` (the live array), `app.store.save(name)`, `app.store.id(prefix)` |
| `lib/page.js` | `esc`, `euro`, the layout (viewport, `<h1>`, navigation, link to the other language) |

## Rules

- **Booking:** a member books a court for one slot (`SLOTS`), today or up to 14 days
  ahead, never in the past. At most 2 upcoming bookings per member, lessons included. A
  slot holds one booking, one lesson or one block.
- **Price:** `price(date, time, guests)`: €12 off-peak, €20 peak (weekdays from 18:00,
  all weekend), + €3 per guest (0-3). Lessons cost the coach's rate. Paid from the
  balance when booking (`402` if it is too low).
- **Cancelling:** 24 hours or more before the start, the price comes back; later,
  nothing. Staff cancels always refund.
- **Waitlist:** a member can wait for a taken slot (one court or any). When a booking for
  it is cancelled, the first waiting member who still can (balance, the 2-booking limit)
  is booked automatically and notified.
- **Blocks:** staff close a court for a slot, or every week at that time until a date.
- **Lessons:** coaches have an hourly rate and working hours per weekday; a lesson needs
  the coach and some court free, and takes that court.
- **Tournaments:** a date and a maximum of players; members sign up until full or closed;
  closing draws a single-elimination bracket in sign-up order, byes for the first seeds
  when the number is not a power of 2; staff enter winners; the last winner is champion.
- **Pro-shop:** products with a price and stock; a member orders for pickup at reception,
  paid from the balance; stock goes down; staff mark orders ready, collected or cancelled
  (cancelled = refund + stock back).
- **Rota:** staff members (not club members) with a role; shifts on a date with a start
  and end inside opening hours, at most 8 hours a day per person, never overlapping for
  the same person.
- **Notifications:** bookings, cancels, waitlist promotions, lessons and shop orders each
  add a message for the member (`app.notify`).

## Modules to build (one file each in `modules/`, pages in English and under `/pt`)

| module | API | pages |
|---|---|---|
| bookings | `POST /api/bookings {court, date, time, guests?}` -> `201 {id, court, date, time, guests, price, status: "booked"}`, `400` rule, `402` balance, `409` slot not free; `GET /api/me/bookings` (upcoming bookings and lessons, soonest first); `POST /api/bookings/<id>/cancel` -> `{..., status: "cancelled", refund}`, `404` if not theirs; `POST /api/admin/bookings/<id>/cancel` | `/book?court=&date=&time=` (confirm, guests, price) |
| member area | | `/me`: upcoming bookings and lessons with cancel buttons, balance, notifications |
| public pages | | `/` (the club, today's free slots per court), `/availability?date=` (courts x slots: free / taken / blocked, with prices) |
| waitlist | `POST /api/waitlist {date, time, court?}` -> `201`, `400` if a matching court is free | a "wait for it" button on taken slots |
| notifications + calendar | `GET /api/me/notifications` (`[{at, text}]`, newest first); `GET /api/me/calendar.ics` (`text/calendar`, one `VEVENT` per upcoming booking or lesson) | |
| blocks | `POST /api/admin/blocks {court, date, time, weeklyUntil?, reason}` -> `201`, `409` if a booking is in the way; `DELETE /api/admin/blocks/<id>` -> `204` | `/admin/blocks` |
| coaches + lessons | `GET /api/coaches` -> `[{id, name, rate}]`; `POST /api/admin/coaches {name, rate, hours: {mon: ["09:00", "13:00"], ...}}` -> `201`; `POST /api/lessons {coach, date, time}` -> `201 {id, coach, court, date, time, price, status}`, `409` coach or courts busy | `/coaches` (book a lesson), `/admin/coaches` |
| tournaments | `GET /api/tournaments` -> `[{id, name, date, max, players: [member ids], status: "open"|"closed"|"finished"}]`; `GET /api/tournaments/<id>` -> `{..., bracket: [[{id, a, b, winner}]], champion}` (rounds in order; a bye is `b: null, winner: a`); `POST /api/tournaments/<id>/register` -> `200`, `409` full/closed/already in; `POST /api/admin/tournaments {name, date, max}` -> `201`; `POST /api/admin/tournaments/<id>/close`; `POST /api/admin/tournaments/<id>/matches/<match> {winner}` (`400` if not in that match) | `/tournaments`, `/tournaments/<id>` (the bracket), `/admin/tournaments` |
| staff admin | `POST /api/admin/members/<id>/credit {amount}` -> `{id, balance}` | `/admin`: today's bookings, members and balances with a top-up form |
| reports | `GET /api/admin/reports/occupancy?date=` -> `[{court, booked, blocked, free}]`; `GET /api/admin/reports/revenue?from=&to=` -> `{bookings, lessons, shop, refunds, total}`; `GET /admin/bookings.csv?date=` (header + one row per booking or lesson) | `/admin/reports` |
| pro-shop | `GET /api/shop/products` -> `[{id, name, price, stock}]`; `POST /api/shop/orders {items: [{product, qty}]}` -> `201 {id, items, total, status: "placed"}`, `400` unknown product / bad qty / not enough stock, `402` balance; `GET /api/me/shop-orders`; `POST /api/admin/shop/products {name, price, stock}` -> `201`; `PATCH /api/admin/shop/products/<id>`; `GET /api/admin/shop/orders`; `PATCH /api/admin/shop/orders/<id> {status: "ready"|"collected"|"cancelled"}` | `/shop` (order form), `/admin/shop` (products, stock, orders) |
| rota | `POST /api/admin/staff {name, role}` -> `201`; `GET /api/admin/staff`; `POST /api/admin/shifts {staff, date, start, end}` -> `201`, `400` outside opening hours or over 8 h that day, `409` overlap; `DELETE /api/admin/shifts/<id>` -> `204`; `GET /api/admin/rota?week=<monday>` -> `[{date, shifts: [{id, staff, start, end}]}]` (7 days); `GET /api/admin/rota/gaps?date=` -> `[{from, to}]` opening hours nobody covers | `/admin/rota` (the week) |

Every page has a phone viewport, an `<h1>` and the navigation (`app.page` does this).
Public and member pages exist in English and Portuguese (`/pt/...`, `<html lang="pt">`),
linked both ways. Escape everything people type. Member calls without a valid token get
`401`, staff calls without the password `401`.
