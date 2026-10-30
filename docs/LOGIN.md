# Operator login and dashboard

## Login interface
The login screen keeps the minimal approved layout:
- POMAD PRIMA logo
- Username field
- Password field
- Masuk button

Enter the local operator username in the form `operator_<normalized-code>`; for example, Iskandar Muda uses `operator_im`.

## Authentication flow
1. The app resolves the username to one of the 21 active Pomdam master records.
2. It maps the username to the matching Supabase Auth email identity `operator_<normalized-code>@puspomad.mil.id`.
3. It authenticates with that identity's existing Supabase password.
4. It calls `public.get_my_access_context()`.
5. The app accepts only `POMDAM_OPERATOR`, a `POMDAM` scope containing exactly the matching Pomdam, and `MANAGE_REPORT_DATA`.
6. Commander accounts and the Puspomad-wide operator account are not accepted in this portal.

The login interface does not create accounts or change passwords. An Auth user and the matching application-role/scope records must be provisioned for each Pomdam before that username can sign in. Password reset or bulk account provisioning must be performed through a trusted Supabase administrator workflow, not from the browser.

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
The current shared project previously had a local operator account for Iskandar Muda and a Puspomad-wide operator account. The Puspomad-wide login is deliberately no longer accepted by this portal. The other Pomdam-specific Auth users and their scopes still need to be provisioned before all 21 usernames are available.

## Security notes
- The frontend uses only the Supabase publishable key.
- No service-role or secret key is included in the browser bundle.
- The frontend does not trust user-editable JWT metadata for role or scope.
- Before report data is connected, review the existing reporting-table RLS policies for Pomdam-level data isolation.
