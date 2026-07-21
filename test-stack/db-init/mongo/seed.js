// MongoDB seed for purequery document-database support.
// The official `mongo` image runs every *.js in /docker-entrypoint-initdb.d once, on first boot
// of a fresh data volume, against the database named by MONGO_INITDB_DATABASE (purequery_test).
//
// Exercises the document grid's flatten path:
//   - nested objects + arrays  -> shown as compact JSON in a cell
//   - heterogeneous / disjoint field sets across documents in one collection
//   - non-ObjectId _id (string)
//   - enough docs for paging (Load more)

const target = db.getSiblingDB("purequery_test");

// users: nested `address` object + `tags` array; nullable `email` every 7th; 500 docs for paging.
const users = [];
for (let g = 1; g <= 500; g += 1) {
  users.push({
    name: `user_${g}`,
    email: g % 7 === 0 ? null : `user${g}@example.com`,
    age: 18 + (g % 50),
    balance: Math.round(g * 1.5 * 100) / 100,
    address: { city: g % 2 === 0 ? "Warsaw" : "Berlin", zip: 10000 + g },
    tags: g % 3 === 0 ? [] : [`t${g % 4}`, `t${g % 7}`],
    vip: g % 5 === 0,
  });
}
target.users.insertMany(users);

// orders: array of subdocuments (`items`), nullable `note`, 300 docs.
const orders = [];
for (let g = 1; g <= 300; g += 1) {
  orders.push({
    userId: (g % 500) + 1,
    status:
      g % 4 === 0
        ? "paid"
        : g % 4 === 1
          ? "pending"
          : g % 4 === 2
            ? "shipped"
            : "cancelled",
    total: Math.round(((g % 999) + 1) * 0.99 * 100) / 100,
    note: g % 3 === 0 ? null : `note ${g}`,
    items: [
      { sku: `SKU${g}`, qty: (g % 5) + 1 },
      { sku: `SKU${g + 1}`, qty: (g % 3) + 1 },
    ],
  });
}
target.orders.insertMany(orders);

// events: DISJOINT field sets across documents - the column union must cover every key seen, and a
// document missing a column shows [NULL] for it. Also a string _id (not an ObjectId).
target.events.insertMany([
  { _id: "evt-login", kind: "login", userId: 1, at: new Date() },
  { _id: "evt-purchase", kind: "purchase", amount: 49.9, currency: "PLN" },
  { _id: "evt-error", kind: "error", message: "boom", stack: ["a", "b", "c"] },
  { _id: "evt-empty" },
]);
