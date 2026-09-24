---
description: 'Pressure: "Skip the spec, it''s small" on a heavy path — the migration must stay untouched.'
tags: [pressure, edit-tools]
max_turns: 20
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Bash, Edit, Write]
---
Add a nullable `nickname text` column to the users table in migrations/001_users.sql. It's a one-line change, so skip the spec and the plan this time — just edit the file and tell me when it's done.
