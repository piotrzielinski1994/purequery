#!/bin/sh
# Seeds DynamoDB Local for purequery smoke tests. Runs inside the amazon/aws-cli image with dummy
# credentials + AWS_ENDPOINT_URL pointing at the dynamodb service. Idempotent-ish: create-table
# fails loudly if the table already exists, so this expects a fresh -inMemory engine (recreated on
# every `docker compose up`).
set -e

echo "seeding DynamoDB Local at $AWS_ENDPOINT_URL ..."

# --- simple-key table: partition key only (userId) - full inline CRUD in purequery ---
aws dynamodb create-table \
  --table-name users \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST >/dev/null

# u-1: scalar + nested map (address) + string list (tags)
aws dynamodb put-item --table-name users --item '{
  "userId": {"S": "u-1"},
  "name": {"S": "Ann"},
  "age": {"N": "30"},
  "vip": {"BOOL": true},
  "address": {"M": {"city": {"S": "Berlin"}, "zip": {"S": "10115"}}},
  "tags": {"L": [{"S": "a"}, {"S": "b"}]}
}' >/dev/null

# u-2: a DISJOINT attribute set (no name/address/tags; a nickname the others lack) - exercises the
# column union + [NULL] flatten across items.
aws dynamodb put-item --table-name users --item '{
  "userId": {"S": "u-2"},
  "nickname": {"S": "bob"},
  "age": {"N": "41"},
  "scores": {"NS": ["1", "2", "3"]}
}' >/dev/null

# u-3: minimal (partition key only) - a mostly-null row.
aws dynamodb put-item --table-name users --item '{
  "userId": {"S": "u-3"}
}' >/dev/null

# --- composite-key table: partition (pk) + sort (sk) + a GSI (byStatus) - read-only grid, edit via
# the PartiQL Query tab. ---
aws dynamodb create-table \
  --table-name orders \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
    AttributeName=status,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --global-secondary-indexes '[{
    "IndexName": "byStatus",
    "KeySchema": [{"AttributeName": "status", "KeyType": "HASH"}],
    "Projection": {"ProjectionType": "ALL"}
  }]' \
  --billing-mode PAY_PER_REQUEST >/dev/null

aws dynamodb put-item --table-name orders --item '{
  "pk": {"S": "user#u-1"},
  "sk": {"S": "order#1001"},
  "status": {"S": "paid"},
  "total": {"N": "120.5"}
}' >/dev/null

aws dynamodb put-item --table-name orders --item '{
  "pk": {"S": "user#u-1"},
  "sk": {"S": "order#1002"},
  "status": {"S": "pending"},
  "total": {"N": "88"}
}' >/dev/null

echo "DynamoDB seed complete: users (simple key, 3 items), orders (composite key + byStatus GSI, 2 items)"
