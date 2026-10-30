# Operator login and dashboard

## Login interface
The login screen keeps the minimal approved layout:
- POMAD PRIMA logo
- Pomdam dropdown
- Password field
- Masuk button

The operator selects their Pomdam from the active master list. The app derives the operator username automatically from the selected Pomdam code. For example, Iskandar Muda maps to `operator_im`; the corresponding Supabase Auth identity is `operator_im@puspomad.mil.id`.

## Authentication flow
1. The operator selects one of the 21 active Pomdam values from the master list.
2. The app derives `operator_<normalized-code>` from the selected Pomdam.
3. It maps that username to the matching Supabase Auth email identity `operator_<normalized-code>@puspomad.mil.id`.
4. It authenticates with that identity's existing Supabase password.
5. It calls `public.get_my_access_context()`.
6. The app accepts only `POMDAM_OPERATOR`, a `POMDAM` scope containing exactly the selected Pomdam, and `MANAGE_REPORT_DATA`.
7. Commander accounts and the Puspomad-wide operator account are not accepted in this portal.

The dropdown selects the operator's Pomdam; it does not grant access by itself. Account creation and password changes are not performed by this login form. Each local Auth user and matching application-role/scope records must be provisioned for that Pomdam before login is available.

## Session handling
- An existing Supabase session is revalidated through `get_my_access_context()` when the app opens.
- A session is restored only when it belongs to a valid local Pomdam operator with exactly one Pomdam scope.
- Other application roles are signed out of this operator portal.
- Logout calls Supabase Auth sign-out.

## Dashboard
After login, the operator lands on the dashboard for their own Pomdam. Six report menus mirror the active `public.report_types` master:
- Statistik Giat Gakkum
- Statistik Laka Lalin
- Statistik Pelanggaran
- Rekapitulasi Provos TNI AD
- Rekapitulasi SIM TNI
- Rekap Tindak Pidana

Each menu currently opens a preparation placeholder. No mock records or report totals are displayed. The first report's entry form and data presentation will be implemented as a separate stage.

## Existing account readiness
The current shared project previously had a local operator account for Iskandar Muda and a Puspomad-wide operator account. The Puspomad-wide login is deliberately no longer accepted by this portal. The other Pomdam-specific Auth users and their scopes still need to be provisioned before all 21 Pomdam choices can log in.

## Security notes
- The frontend uses only the Supabase publishable key.
- No service-role or secret key is included in the browser bundle.
- The frontend does not trust user-editable JWT metadata for role or scope.
- Before report data is connected, review the existing reporting-table RLS policies for Pomdam-level data isolation.
