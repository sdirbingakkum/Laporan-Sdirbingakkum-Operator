# Laporan Sdirbingakkum Operator

Mobile-first portal for authorized Pomdam operators to prepare and submit monthly reports.

## Stack
- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- Supabase Auth + PostgreSQL RPC/RLS (shared existing project)
- Cloudflare Pages
- GitHub Actions

## Security principles
- The Pomdam dropdown selects the intended operator identity; it is not an authorization control.
- After Supabase Auth, the app verifies the user's role and Pomdam scope using `public.get_my_access_context()`.
- Database RLS remains the enforcement boundary. Never trust Pomdam IDs, roles, or capabilities supplied by the browser.
- Only the Supabase publishable key may be exposed to the frontend. Never commit service-role or secret keys.
- This repository is public; never commit credentials or production data.

## Shared backend
This app uses the existing Laporan Sdirbingakkum Supabase project. It must not create or connect to a second production database.

## Development
See `docs/LOGIN.md` for the login-stage design and integration contract.

1. Copy `.env.example` to `.env.local`.
2. Set the existing Supabase URL and publishable key.
3. Run `npm install`.
4. Run `npm run dev`.

## Environment
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Login identity convention
The selected Pomdam code maps to an operator Auth identity using `operator_<normalized-code>@puspomad.mil.id`. Authentication alone does not grant access: the returned access context must identify `POMDAM_OPERATOR`, `POMDAM` scope, and the exact selected Pomdam UUID.
