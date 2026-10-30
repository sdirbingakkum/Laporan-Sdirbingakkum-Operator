# Cloudflare deployment

## Preview
- Cloudflare Pages project: `laporan-sdirbingakkum-operator`
- Build command: `npm run build`
- Build output: `dist`
- Preview branches: all branches
- Preview must use the existing Supabase project URL and publishable key so Auth login works.
- Do not use demo credentials or a fake login path.

## Production
- Production branch: `main`
- Automatic production deployments remain disabled while the owner reviews the preview.
- Configure the same existing Supabase project URL and publishable key for Production before enabling deployment.
- Production must not be enabled as part of a preview-only change.

## Environment variables
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Only the publishable key belongs in Vite client environment variables. Never add a Supabase service-role or secret key to this repository or Cloudflare client build configuration.
