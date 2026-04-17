# -----------------------------
# PLAN / BILLING BEHAVIOR
# Canonical entitlement vocabulary: basic / pro / premium
# Stripe-backed paid plans: pro / premium
# -----------------------------
PLAN_REQUIRE_CARD = false # Whether paid plan checkout should require a payment method up front
PLAN_TRIAL_MISSING_PAYMENT_METHOD_BEHAVIOR = cancel # What to do when a trial ends without a payment method (for example: cancel or pause)
PLAN_ALLOW_PROMOTION_CODES = true # Whether checkout should allow customer-entered promotion / coupon codes
PLAN_LIMIT_ONE_SUBSCRIPTION = true # Whether to block users from starting a second subscription when one is already active

PLAN_PRO_MONTHLY_USD_CENTS = 900 # Display/reference monthly price for the Pro plan in USD cents ($9.00)
PLAN_PREMIUM_MONTHLY_USD_CENTS = 1700 # Display/reference monthly price for the Premium plan in USD cents ($17.00)
PLAN_PRO_TRIAL_DAYS = 3 # Number of trial days for the Pro plan
PLAN_PREMIUM_TRIAL_DAYS = 0 # Number of trial days for the Premium plan

# -----------------------------
# STRIPE
# -----------------------------
STRIPE_PRICE_PRO_MONTHLY= price_*** # Stripe monthly Price object ID used to bill the Pro subscription
STRIPE_PRICE_PREMIUM_MONTHLY= price_*** # Stripe monthly Price object ID used to bill the Premium subscription
STRIPE_AUTOMATIC_TAX = true # Enable Stripe automatic tax calculation for Stripe checkout sessions
STRIPE_SECRET_KEY = *** # Stripe secret API key used by the backend for Checkout, billing, and other Stripe server actions
STRIPE_PUBLISHABLE_KEY = *** # Stripe publishable key used by the frontend for Stripe client-side initialization
STRIPE_WEBHOOK_SECRET = *** # Stripe webhook signing secret used to verify incoming webhook events

# -----------------------------
# APP / PUBLIC URLS
# -----------------------------
APP_BASE_URL = https://your-public-app.example # Canonical public app origin used for auth email redirects and billing return URLs
PUBLIC_APP_URL = https://your-public-app.example # Fallback canonical public app origin if APP_BASE_URL is not set
SITE_URL = https://your-public-app.example # Final fallback canonical public app origin if the other public URL envs are not set

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