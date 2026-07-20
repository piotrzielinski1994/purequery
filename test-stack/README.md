# purequery test stack

Docker Postgres + MySQL + MongoDB + SQL Server + DynamoDB Local, seeded for engine smoke tests (held
pool / multi-statement / transactions / cancel for SQL; collection browse / find / aggregate / CRUD
for Mongo; PartiQL browse / query / item CRUD for DynamoDB). Non-default host ports so they don't
clash with your own local DBs.

## Run

```bash
cd test-stack
docker compose up -d          # first boot runs db-init/* to seed
docker compose ps             # wait until both are healthy
# ...test in purequery...
docker compose down           # stop, keep data
docker compose down -v        # stop + wipe (re-seeds next up)
```

## Connect in purequery (Settings tab -> Connect)

| Field    | Postgres        | Postgres (public-only) | MySQL           | SQL Server        |
| -------- | --------------- | ---------------------- | --------------- | ----------------- |
| Engine   | postgres        | postgres               | mysql           | sqlserver         |
| Host     | localhost       | localhost              | localhost       | localhost         |
| Port     | **55432**       | **55433**              | **33061**       | **14330**         |
| Database | purequery_test       | purequery_public            | purequery_test       | purequery_test         |
| User     | purequery            | purequery                   | purequery            | sa                |
| Password | purequery            | purequery                   | purequery            | purequery_test!2026    |

- **SQL Server** (`purequery_test`, 14330, azure-sql-edge arm64) - multi-schema (`dbo` + `sales`),
  composite-PK `sales.line_items`, FK for FK-nav, a check constraint, and one of each object kind
  (procedure `usp_user_count`, function `ufn_order_total`, trigger `trg_orders_audit`, sequence
  `invoice_seq`). Seeded by the one-shot `mssql-seed` sidecar.

- **Postgres** (`purequery_test`, 55432) - multi-schema (`public` + `vehicle_listing`).
- **Postgres public-only** (`purequery_public`, 55433) - every table in `public`; one schema row.
- **MySQL** (`purequery_test`, 33061) - flat, no schema level.
- SQLite available without Docker: `.pzielinski/test.sqlite` (flat).

### DynamoDB (key-value / NoSQL engine, port 8009)

DynamoDB Local runs in-memory; connect with the **Endpoint URL** override + any dummy credentials
(the local engine ignores their value). The "database" is a region.

| Field           | DynamoDB                       |
| --------------- | ------------------------------ |
| Engine          | dynamodb                       |
| Region          | eu-west-1                      |
| Access key id   | dummy                          |
| Secret access key | dummy                        |
| Endpoint URL    | `http://localhost:8009`        |

Seeded tables: `users` (simple partition key `userId`, 3 items - one with a nested `address` map +
`tags` list, one with a **disjoint** attribute set + a number-set, one key-only) - full inline CRUD;
`orders` (composite key `pk`+`sk`, 2 items, plus a `byStatus` GSI) - read-only grid, writable via
the PartiQL Query tab. Exercise the item flatten (nested -> compact JSON, missing -> `[NULL]`), token
paging, approx `~count`, disabled sort, PartiQL SELECT/INSERT/UPDATE/DELETE, and the Structure view
(key schema + GSI).

### MongoDB (document engine, port 27018)

The root user lives in the `admin` database, so connect via the **Connection string (URI)**
field (it overrides the discrete fields):

```
mongodb://purequery:purequery@localhost:27018/purequery_test?authSource=admin
```

| Field    | MongoDB                                                            |
| -------- | ----------------------------------------------------------------- |
| Engine   | mongodb                                                            |
| URI      | `mongodb://purequery:purequery@localhost:27018/purequery_test?authSource=admin`   |
| Database | purequery_test                                                         |

Seeded collections: `users` (500 docs, nested `address` object + `tags` array, nullable email),
`orders` (300 docs, `items` array of subdocuments), `events` (4 docs with **disjoint** field sets
and string `_id`s) - exercise the document grid's flatten (nested -> compact JSON, missing field
-> `[NULL]`), paging, JSON find filter, and CRUD.

## What's seeded

- `users` (500 rows, PK, NOT NULL name, nullable email every 7th, numeric/timestamp; PG also
  uuid + jsonb) - paging + type subheader + cell edit.
- `orders` (300 rows, PK, FK to users, nullable note) - more paging.
- `events` (40 rows, **no PK**) - edit/delete/clone must be disabled with a reason.
- Postgres only: `"weird name"` table with a `"col;with;semis"` column - quoting on the write path;
  and a second schema `vehicle_listing` (tables `listing`, `vehicle`, `users`) for the
  **schema-tree feature**: the sidebar groups tables under their schema row and addressing is
  schema-qualified end-to-end. `vehicle_listing.users` collides by name with `public.users` -
  they must be distinct leaves that open/browse/edit independently.

## Schema-tree smoke checklist (Postgres)

Connect the Postgres DB and expand it in the sidebar.

1. **Schema grouping** - the tree shows schema rows `public` and `vehicle_listing` (not a flat
   table list); expanding each lists its tables. MySQL/SQLite stay flat (no schema row).
2. **Name collision** - expand both schemas: `public.users` (500 rows, `name`/`email`/...) and
   `vehicle_listing.users` (10 rows, `dealer`/`region`) are distinct leaves. Open each -> different
   rows/columns. Edit a cell in one -> the other is untouched (refetch to confirm).
3. **Cross-schema open** - open `vehicle_listing.listing` / `vehicle_listing.vehicle` -> rows load
   (no "relation does not exist"); the History SQL is schema-qualified (`"vehicle_listing"."..."`).

## F5 smoke checklist

Run these in the SQL tab of a connected DB.

1. **Held pool (#21)** - run a query, run another, open a table, run again. No reconnect churn;
   all succeed against the one held connection. Disconnect, then try Run -> "Connect first".
2. **Multi-statement (#8)** - `SELECT 1 AS a; SELECT 2 AS b;`
   -> grid shows the LAST result (b=2); History gains TWO entries; status "2 statements - OK".
3. **Transaction spans one connection (#8)**
   - Postgres / MySQL:
     ```sql
     BEGIN;
     UPDATE users SET name = 'CHANGED' WHERE id = 1;
     SELECT name FROM users WHERE id = 1;   -- shows CHANGED inside the txn
     ROLLBACK;
     ```
     Then `SELECT name FROM users WHERE id = 1;` separately -> back to original (rollback worked,
     proving all three ran on the SAME connection).
4. **Split safety (#8)** - `SELECT 'a;b;c' AS x;` -> ONE row `a;b;c` (the `;` inside the string
   does not split). On Postgres also try a dollar-quoted body:
   `DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;` -> runs as one statement, no split error.
5. **Cancel (#6)** - run a slow query, the Run button becomes **Cancel**, click it
   -> neutral "Cancelled" status (muted, not a red error), no error in History.
   - Postgres: `SELECT pg_sleep(30);`
   - MySQL: `SELECT SLEEP(30);`
   - SQLite (no sleep fn): `WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < 50000000) SELECT count(*) FROM c;`
     (Note: cancel aborts at the next await point - a statement already executing server-side keeps
      running until it yields; there is no server-side kill. Expected, documented limitation.)
