# Forno da Vila

The website for Forno da Vila, a small bakery in Lisbon: customers look at the menu and
order bread and cakes for pickup; the owner runs everything from an admin area on her phone.

Nothing is built yet: `server.js` only says "coming soon".

## Stack (fixed)

- Node 22, **no dependencies** (built-in modules only). `node server.js` starts it on
  `PORT` (default 3000). Pages are rendered on the server and work without JavaScript.
- Data lives in JSON files under `DATA_DIR` (default `./data`) and survives a restart.
  An empty `DATA_DIR` starts with a sensible menu (at least 8 items in at least 3
  categories) and opening hours.
- The admin area and admin API use HTTP basic auth: user `admin`, password from
  `ADMIN_PASSWORD` (default `admin`).
- Tests: `node --test`. Prices are euros (numbers like `2.5`), shown as `€2.50`.
- Times are Lisbon local time, written `YYYY-MM-DDTHH:MM` (pickup) and `HH:MM` (hours).

## Pages

| path | what |
|---|---|
| `/` | the bakery, today's opening hours, links to the menu and to ordering |
| `/menu` | every item with its price, by category; sold-out items marked |
| `/order` | an order form (name, phone, pickup time, quantities); submitting it creates the order and redirects to its confirmation |
| `/orders/<id>` | the confirmation: order number, items, total, pickup time, status |
| `/admin` | today's and upcoming orders, newest first, with buttons to change their status |
| `/admin/menu` | add, edit, mark sold out and remove items |
| `/admin/hours` | edit the opening hours |

Every page has a phone viewport, an `<h1>` and a navigation to the public pages.

The public pages also exist in Portuguese under `/pt` (`/pt`, `/pt/menu`, `/pt/order`,
`/pt/orders/<id>`), with `<html lang="pt">`; every public page links to its other language.
The menu shows each item's allergens, and `/menu?without=<allergen>` (also in Portuguese)
leaves out items containing it. The confirmation page has a button to cancel the order.
The owner can download a day's orders as `/admin/orders.csv?date=YYYY-MM-DD`: a header
row, then one row per order picked up that day (id, name, phone, pickup time, items,
total, status).

## API (JSON, used by the pages' tests and a future app)

| method + path | body | answer |
|---|---|---|
| `GET /api/menu` | | `[{id, name, price, category, available, allergens: [...], stock, description?}]`: allergens from `gluten`, `milk`, `egg`, `nuts`, `soy`, `sesame`; `stock` = how many can still be ordered, or `null` for no limit |
| `GET /api/hours` | | 7 entries, Monday first: `{day: "mon".."sun", open: "HH:MM", close: "HH:MM"}` or `{day, closed: true}` |
| `POST /api/orders` | `{name, phone, pickupAt, items: [{id, qty}]}` | `201 {id, status: "received", name, phone, pickupAt, items: [{id, name, qty, price}], total}` |
| `GET /api/orders/<id>` | | `200` the order, `404` unknown |
| `POST /api/orders/<id>/cancel` | | `200` the order with status `cancelled`; `409` if it is less than 2 hours before pickup or already collected or cancelled |
| `GET /api/slots?date=YYYY-MM-DD` | | the pickup slots of that day: every 15 minutes from opening to 15 minutes before closing, `[{time: "HH:MM", left}]` |
| `GET /api/admin/orders` | | all orders, newest first |
| `PATCH /api/admin/orders/<id>` | `{status}` (`received`, `baking`, `ready`, `collected`, `cancelled`) | `200` the order |
| `POST /api/admin/menu` | `{name, price, category, available?, description?}` | `201` the item |
| `PATCH /api/admin/menu/<id>` | any of those fields | `200` the item |
| `DELETE /api/admin/menu/<id>` | | `204` |
| `PUT /api/admin/hours` | the 7 entries | `200` the hours |
| `PUT /api/admin/settings` | `{slotCapacity}` (orders per 15-minute slot, default 4) | `200` the settings |

An order is refused with `400 {error}` when it has no items, an unknown or sold-out item,
a quantity that is not a whole number from 1 to 20, no name or phone, or a pickup time
that is in the past, outside that day's opening hours or not on a slot (`:00`, `:15`,
`:30`, `:45`). An order for a slot that is already full gets `409 {error}`. Ordering
takes items out of stock: an item whose stock reaches 0 is sold out, and an order
for more than is left is refused with `400`. The owner sets stock with
`PATCH /api/admin/menu/<id>` `{stock}`. Admin calls without the right password get `401`.
