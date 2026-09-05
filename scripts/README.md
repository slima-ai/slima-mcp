# `e2e.mjs` — the real client, over stdio, against a real Rails

Every layer here has its own tests and they are all green. This script exists
for the class of bug that lives in the **seam** between two of them, where both
sides look right on their own:

- a controller that never permitted the param the client sends
- a tool that was written but never registered in one of the two entry points
- a field the server returns and the client's renderer quietly drops
- `false.present?` being `false`, so a legitimate `interior: false` reads as
  "required field missing"

The last two are not hypothetical: this script caught both of them on its first
run, after 300 client tests and 585 Rails specs were already passing.

## Running it

```bash
# 1. Rails, with a real user + book + mcp:books token
bin/rails runner '
  u = User.create!(email: "mcp-e2e@example.test", password: "Passw0rd!e2e", name: "E2E",
                   subscription_status: "active", subscription_plan: "pro",
                   subscription_expires_at: 1.month.from_now)
  b = Book.create!(user: u, title: "E2E")
  br = Branch.create!(book: b, name: "main", is_default: true)
  Commits::CreateService.new(book: b, branch: br, user: u, params: {
    name: "init", message: "init", files_snapshot: [], commit_type: "auto",
    device_id: "seed", device_name: "seed" }).call
  b.update!(default_branch: br)
  puts "TOKEN=#{ApiToken.create!(user: u, name: "e2e", scope: "mcp:books").token}"
  puts "BOOK=#{b.token}"'

# 2. Build the client, then drive it
npm run build
TOKEN=... BOOK=... API_URL=http://127.0.0.1:3000 node scripts/e2e.mjs
```

⚠️ **The book must be fresh.** The script creates files at fixed paths, so a
second run against the same book fails on `FILE_EXISTS` — that is the script
being honest about a real conflict, not a flake.

⚠️ **The user must be on a paid plan.** Writing a structured type is gated by
subscription (`Mcp::Entitlement`); a free user is *supposed* to get 403s here.

## What it covers

Discovery (`tools/list`, and that no advertised schema carries a key Gemini's
`parameters` proto rejects — one bad key kills the whole catalogue), teaching
(`get_capabilities` / `list_guides` / `load_guide`), prose CRUD, the three
structured types end to end, every error an agent has to be able to act on
(unknown id, a field from another operation, a forward `op_ref`, a batch aimed
at the wrong type), the read-only refusals, the `.map` whole-file guard, and
`view_relationship_map`.
