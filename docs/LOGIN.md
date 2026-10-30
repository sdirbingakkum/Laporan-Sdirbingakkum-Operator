# Operator login

## Interface
The login screen is intentionally minimal:
- POMAD PRIMA logo
- Login heading
- Pomdam selector
- Password field
- Masuk button

The same layout is responsive on desktop and mobile. There are no demo credentials, slogans, promotional copy, or decorative military-themed elements.

## Authentication flow
1. The user selects one of the 21 active Pomdam values from the audited `public.pomdams` master-data snapshot.
2. The client tries the corresponding local operator identity: `operator_<normalized-code>@puspomad.mil.id`.
3. If those credentials are rejected, the client also tries the existing Puspomad-wide operator identity: `operator@puspomad.mil.id`.
4. After Supabase Auth succeeds, the client calls `public.get_my_access_context()`.
5. The client accepts access only when the user is authenticated/configured and has `MANAGE_REPORT_DATA`:
   - `POMDAM_OPERATOR` must have `POMDAM` scope containing the selected Pomdam UUID, and the authenticated email must match that Pomdam's local operator identity.
   - `PUSPOMAD_OPERATOR` must have `ALL_POMDAM` scope and use the Puspomad-wide operator identity.
6. Any mismatch signs out the authenticated session and denies entry.

The Pomdam dropdown is a user-context selector, not an authorization boundary. Scope and capability values always come from the Supabase RPC, and data authorization remains the database's responsibility.

## Session handling
- The Supabase session is restored when the app opens.
- On restore, the client calls `get_my_access_context()` again rather than trusting a previously stored role or scope.
- A local Pomdam operator is restored from its single active database scope.
- The Puspomad-wide operator's selected Pomdam is remembered only as a user-interface preference. It does not grant access.
- Logout calls Supabase Auth sign-out and clears the remembered Pomdam selection.

## Existing account availability
The current shared Supabase project contains:
- A `POMDAM_OPERATOR` identity scoped to Iskandar Muda.
- A `PUSPOMAD_OPERATOR` identity scoped to `ALL_POMDAM`.

The other active Pomdam values are present in the dropdown, but their local operator Auth identities and scopes have not been provisioned yet. They can be used by the Puspomad-wide operator account. A local operator for another Pomdam must be provisioned by an administrator with an individual password and the correct database role/scope before login will succeed.

## Security and scope
- The frontend uses only the Supabase publishable key.
- No service-role or secret key is included in the client.
- No Auth users, passwords, roles, Pomdam scopes, database rows, schema, or RLS policies are created or changed by this app.
- The app does not trust user-editable JWT metadata for authorization.
- The current post-login screen is a minimal authenticated landing state. Report-entry forms and data modules are a separate next development stage.
- Before report data is added to the client, review and tighten existing reporting-table RLS policies. Authentication and UI scope checks do not replace row-level database authorization.
