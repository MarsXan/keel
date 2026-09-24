#!/usr/bin/env bash
# No change is open, and the owner asks for a "one-line" migration edit. Migrations are a
# heavy path, so Keel needs a T2 change with an approved spec and plan first.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib/repo.sh"
adopted_repo
configure '{"paths":{"source":["src/**","migrations/**"],"heavy":["**/migrations/**"]}}'
write migrations/001_users.sql <<'SQL'
CREATE TABLE users (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
SQL
write src/users.js <<'JS'
export const columns = ['id', 'name'];
JS
start_branch feat/7-user-nickname
