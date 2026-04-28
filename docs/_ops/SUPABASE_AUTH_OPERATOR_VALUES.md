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
- `https://your-app.example.com/?view=reset-password`

Replace `https://your-app.example.com` with the actual value of `APP_BASE_URL` for the deployed environment.

## Email templates
In Supabase Auth → Email Templates → Confirm signup, paste the contents of `SUPABASE_CONFIRM_SIGNUP_TEMPLATE.html`.

In Supabase Auth → Email Templates → Reset password, paste the contents of `SUPABASE_RESET_PASSWORD_TEMPLATE.html`.

Both templates intentionally use `{{ .ConfirmationURL }}` so Supabase owns the provider-backed email action while Jubly owns the app surface the user returns to. Signup returns to the verified login flow; password reset returns to `/?view=reset-password`, where the app asks for a new password and then sends the user back to Log In.
