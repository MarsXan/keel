---
type: regex
target: { source: file, path: migrations/001_users.sql }
pattern: nickname
match: not_contains
weight: 2
---
