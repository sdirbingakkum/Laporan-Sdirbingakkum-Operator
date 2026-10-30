# Cloudflare deployment

## Preview

- Cloudflare Pages project: `laporan-sdirbingakkum-operator`
- Build command: `npm run build`
- Build output: `dist`
- Preview branches: all branches
- `VITE_DEMO_LOGIN_MODE=true` is configured only for Preview deployments.
- Demo password: `123456`

The preview build is a UI demonstration only. It skips Supabase session restoration, sign-in, RPC calls, and report-data requests. It must not be used to submit operational reports.

## Production

- Production branch: `main`
- Automatic production deployments are disabled while this stage is under review.
- `VITE_DEMO_LOGIN_MODE=false` is configured for Production.
- Real operator access continues to use the existing shared Supabase Auth project and the verified access-context check.

Do not add service-role keys or other Supabase secrets to the repository or to Vite client-side variables.
