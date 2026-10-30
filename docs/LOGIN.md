# Login stage

## Visual direction
- Deep charcoal / forest-green background with restrained antique-gold accents.
- Warm ivory login surface, precise typography, fine borders, low-noise ornamentation.
- Original user-supplied POMAD PRIMA emblem is used as the brand mark.
- Responsive layout: two-column desktop, compact single-column mobile.

## Flow
1. Operator selects one of the 21 active Pomdam records from the existing `public.pomdams` master set.
2. The selected code is mapped to the operator email convention:
   `operator_<normalized-code>@puspomad.mil.id`.
3. Supabase Auth validates the password.
4. The client calls `public.get_my_access_context()`.
5. Access is accepted only when the context is authenticated/configured, role is `POMDAM_OPERATOR`, scope is `POMDAM`, the scope includes the selected Pomdam UUID, and capability `MANAGE_REPORT_DATA` exists.
6. If the context does not match, the client signs out and denies entry.

## Security
- The dropdown is a UX identity selector only; it is not an authorization boundary.
- All data access remains protected by the existing Supabase RLS policies.
- Do not use user-editable JWT metadata for authorization.
- Do not expose service-role/secret keys in this public repository.
- Do not create operator users by writing directly to `auth.users`; provision via the supported Auth Admin API and enforce a secure initial-password/change flow.

## Current limitations
- The login screen's Pomdam choices are derived from the audited active master records and embedded in this first stage. A later backend step can expose a safe public list RPC if the master data needs to be fully dynamic.
- Existing production Auth has an operator identity for Iskandar Muda only. Other Pomdam operator accounts are not provisioned by this UI.
- This stage does not change production Supabase schema, users, roles, or RLS.
- The Pomdam dropdown is a verified snapshot of the 21 active rows in `public.pomdams`. The table currently permits SELECT to authenticated users only, so the public login page cannot query it directly. A later migration can expose only the minimal active fields through a narrowly scoped public RPC.
- Supabase sessions are restored at app startup and the access context is re-checked before reopening the verified screen. A stored browser session alone is never treated as authorization.
- The requested shared demo password `123456` must not be assigned to accounts that receive `POMDAM_OPERATOR`, a Pomdam scope, or `MANAGE_REPORT_DATA` on the shared production database. Demo identities can be created only as unprivileged accounts until unique passwords are set and access is explicitly provisioned.
- A successful authentication displays a verified-access placeholder; the operator dashboard is the next development stage.
