---
name: search-first
description: Search the repository for existing code before writing new code — functions, modules, ports and patterns that already solve part of the problem. Use before adding any function, helper, file, dependency or abstraction.
---
# Search before you build

Duplicated logic is the cheapest code to write and the most expensive to keep.

Before writing new code:
1. Search by concept, not only by name: Grep for the domain words, Glob for likely file names.
2. Read the closest existing implementation and its tests.
3. Reuse or extend it when it fits. When it almost fits, say why you are not using it.
4. Respect ownership: reuse across bounded contexts goes through an application-level port or an event, never a direct import of another context's internals.

Before adding a dependency, check whether the standard library or an existing dependency already does it.

Record the decision — "reused X from path", or "new, because …" — in your report or as a Ruling in the change file.
