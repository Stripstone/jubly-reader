# -----------------------------
# PLAN / BILLING BEHAVIOR
# Canonical entitlement vocabulary: basic / pro / premium
# Stripe-backed paid plans: pro / premium
# -----------------------------
PLAN_REQUIRE_CARD = false # Wired now: when true, Checkout always collects a payment method up front
PLAN_TRIAL_MISSING_PAYMENT_METHOD_BEHAVIOR = cancel # Wired now: Checkout trial end behavior when no payment method is collected (cancel / pause / create_invoice)
PLAN_ALLOW_PROMOTION_CODES = true # Wired now: whether hosted Checkout allows promotion / coupon codes
PLAN_LIMIT_ONE_SUBSCRIPTION = true # Wired now: blocks a second Stripe subscription and sends the user to Manage Billing instead

PLAN_PRO_MONTHLY_USD_CENTS = 900 # Display/reference monthly price for the Pro plan in USD cents ($9.00)
PLAN_PREMIUM_MONTHLY_USD_CENTS = 1700 # Display/reference monthly price for the Premium plan in USD cents ($17.00)
PLAN_PRO_TRIAL_DAYS = 3 # Wired now: trial days passed to Stripe Checkout for the Pro plan
PLAN_PREMIUM_TRIAL_DAYS = 0 # Wired now: trial days passed to Stripe Checkout for the Premium plan

# -----------------------------
# APP ORIGIN / RETURN URLS
# Used by backend auth and billing return URLs when you want to override
# request-derived origin detection.
# -----------------------------
APP_BASE_URL = https://example.com # Preferred explicit app origin for checkout success/cancel and portal return URLs
PUBLIC_APP_URL = https://example.com # Fallback explicit app origin if APP_BASE_URL is unset
SITE_URL = https://example.com # Final fallback explicit app origin if neither APP_BASE_URL nor PUBLIC_APP_URL is set

# -----------------------------
# STRIPE
# -----------------------------
STRIPE_PRICE_PRO_MONTHLY= price_*** # Stripe monthly Price object ID used to bill the Pro subscription
STRIPE_PRICE_PREMIUM_MONTHLY= price_*** # Stripe monthly Price object ID used to bill the Premium subscription
STRIPE_AUTOMATIC_TAX = true # Wired now: enables Stripe automatic tax calculation for hosted Checkout sessions
STRIPE_SECRET_KEY = *** # Stripe secret API key used by the backend for Checkout, billing, and other Stripe server actions
STRIPE_PUBLISHABLE_KEY = *** # Not required by the current hosted-Checkout flow; keep only if client-side Stripe components are added later
STRIPE_WEBHOOK_SECRET = *** # Stripe webhook signing secret used to verify incoming webhook events

# -----------------------------
# SUPABASE
# -----------------------------
DEV_CREDA = *** # Developer account auth
SUPABASE_URL = *** # Supabase project URL
SUPABASE_ANON_KEY = *** # Supabase public anon key used by the frontend client
SUPABASE_SECRET_KEY = *** # Supabase server-side secret key used by backend/server functions

# -----------------------------
# AZURE SPEECH
# -----------------------------
AZURE_SPEECH_KEY = *** # Azure Speech service API key
AZURE_SPEECH_REGION = *** # Azure Speech service region

# -----------------------------
# AI / MODEL / CONVERSION
# -----------------------------
GROQ_MODEL = *** # Default Groq model name or ID used for requests
GROQ_API_KEY = *** # Groq API key
FREECONVERT_API_KEY = *** # FreeConvert API key

# -----------------------------
# AWS / STORAGE
# -----------------------------
AWS_S3_BUCKET = *** # AWS S3 bucket name
AWS_ACCESS_KEY_ID = *** # AWS access key ID
AWS_SECRET_ACCESS_KEY = *** # AWS secret access key