# TriumpCode

AI coding agent in your terminal, by TRIUMP AI.

```bash
npm install -g https://triumpai.com/dl/triumpcode.tgz
triumpcode login        # opens the browser, approve the code
cd my-project && triumpcode
```

- Reads, searches and edits files in the current folder only.
- Every write and every command asks first: `y` yes, `n` no, `a` always (this session).
- `triumpcode -p "task" --yes` runs one task non-interactively.
- `/clear` new conversation, `/usage` plan and quota, `/exit` quit, `Ctrl+C` stop the current task.
- Another server: `triumpcode --server https://your-domain login`.

Requires Node.js 18.17+. No dependencies.
