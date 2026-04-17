# Supabase Auth Operator Values

Use `APP_BASE_URL` as the single canonical public origin.

## Site URL
Set Supabase Auth Site URL to:

`APP_BASE_URL`

It should be the bare app origin, not a view URL.

## Redirect URLs
Add these exact redirect URLs in Supabase Auth:

- `APP_BASE_URL/?view=login-page`
- `APP_BASE_URL/?view=login-page&auth=verified`
- `APP_BASE_URL/?view=login-page&auth=verified&next=checkout&tier=pro`
- `APP_BASE_URL/?view=login-page&auth=verified&next=checkout&tier=premium`

## Email template
In Supabase Auth → Email Templates → Confirm signup, paste the contents of `SUPABASE_CONFIRM_SIGNUP_TEMPLATE.html`.

The template intentionally uses `{{ .ConfirmationURL }}` so verification stays provider-backed while continuation returns to the app-owned verified login flow. After confirm, the app clears any transient auto-login session and lands on login with preserved continuation intent.
