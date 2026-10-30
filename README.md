# Laporan Sdirbingakkum Operator

Minimal operator login portal for the existing Laporan Sdirbingakkum system.

## Stack
- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- Supabase Auth + PostgreSQL access-context RPC
- Cloudflare Pages
- GitHub Actions

## Login behavior
- The user selects a Pomdam and enters their existing Supabase Auth password.
- The client first tries the Pomdam-specific identity `operator_<normalized-code>@puspomad.mil.id`.
- It also supports the existing Puspomad-wide operator identity `operator@puspomad.mil.id`.
- A successful password check alone is not enough. The client calls `public.get_my_access_context()` and accepts only `POMDAM_OPERATOR` with the selected Pomdam scope, or `PUSPOMAD_OPERATOR` with `ALL_POMDAM`. Both require `MANAGE_REPORT_DATA`.
- Database RLS remains the enforcement boundary. The dropdown and remembered Pomdam are never authorization controls.

## Account readiness
The active Pomdam list is the verified 21-row master-data snapshot from `public.pomdams`. The current backend has a Pomdam-scoped operator identity for Iskandar Muda and a Puspomad-wide operator identity. Other Pomdam-specific accounts must be provisioned by the system administrator before those local identities can sign in.

## Security
- Only the Supabase publishable key is sent to the browser.
- Never expose service-role or secret keys in this public repository.
- Never trust browser-supplied role, Pomdam ID, or capability values.
- This repository does not create or modify Supabase users, passwords, roles, scopes, schema, or RLS policies.

## Development
1. Copy `.env.example` to `.env.local`.
2. Set the existing Supabase URL and publishable key.
3. Run `npm install`.
4. Run `npm run test`, `npm run typecheck`, and `npm run build`.
5. Run `npm run dev`.

## Environment
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

See `docs/LOGIN.md` and `docs/DEPLOYMENT.md` for the integration and deployment details.
