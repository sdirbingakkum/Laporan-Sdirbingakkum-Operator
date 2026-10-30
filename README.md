# Laporan Sdirbingakkum Operator

Operator portal for the Laporan Sdirbingakkum system.

## Stack
- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- Supabase Auth + PostgreSQL access-context RPC
- Cloudflare Pages
- GitHub Actions

## Operator login
- The login form keeps a Pomdam dropdown; selecting a Pomdam automatically derives its operator username, such as `operator_im`.
- The username is mapped to the corresponding local Supabase Auth identity: `operator_<normalized-code>@puspomad.mil.id`.
- After password authentication, the app calls `public.get_my_access_context()` and accepts only `POMDAM_OPERATOR` with a single matching `POMDAM` scope and `MANAGE_REPORT_DATA` capability.
- Commander accounts and the Puspomad-wide operator account are not accepted by this operator portal.
- The browser does not create Auth users or set/reset passwords. Each local operator identity must exist in Supabase Auth and have its matching application role, Pomdam scope, and capability.

## Dashboard and report modules
The dashboard menu follows the six active rows in `public.report_types`:
1. Statistik Giat Gakkum
2. Statistik Laka Lalin
3. Statistik Pelanggaran
4. Rekapitulasi Provos TNI AD
5. Rekapitulasi SIM TNI
6. Rekap Tindak Pidana

The menu and placeholder destinations are implemented. Report forms, data queries, calculations, and exports are intentionally not included yet; each module is marked as being prepared until its first report is built.

## Development
1. Copy `.env.example` to `.env.local`.
2. Set the existing Supabase URL and publishable key.
3. Run `npm install`.
4. Run `npm run test`, `npm run typecheck`, and `npm run build`.
5. Run `npm run dev`.

## Environment
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Only the publishable key belongs in Vite client environment variables. Never expose a Supabase service-role or secret key in this public repository.
