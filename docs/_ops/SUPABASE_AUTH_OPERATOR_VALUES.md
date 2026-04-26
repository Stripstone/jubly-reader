# Supabase Auth Operator Values

Use `APP_BASE_URL` as the single canonical public origin in code and env.

Important: the Supabase dashboard does **not** resolve env variable names. Paste the actual resolved production/staging URL, not the literal text `APP_BASE_URL`.

## Site URL
Set Supabase Auth Site URL to the bare resolved app origin, for example:

`https://your-app.example.com`

It should be the bare app origin, not a view URL.

## Redirect URLs
Add these exact redirect URLs using the same resolved origin:

- `https://your-app.example.com/?view=login-page`
- `https://your-app.example.com/?view=login-page&auth=verified`
- `https://your-app.example.com/?view=login-page&auth=verified&next=checkout&tier=pro`
- `https://your-app.example.com/?view=login-page&auth=verified&next=checkout&tier=premium`

Replace `https://your-app.example.com` with the actual value of `APP_BASE_URL` for the deployed environment.

## Email template
In Supabase Auth → Email Templates → Confirm signup, paste the contents of `SUPABASE_CONFIRM_SIGNUP_TEMPLATE.html`.

The template intentionally uses `{{ .ConfirmationURL }}` so verification stays provider-backed while continuation returns to the app-owned verified login flow. The app preserves the active continuation intent and clears stale paid-intent markers when the user leaves the auth/checkout path.
