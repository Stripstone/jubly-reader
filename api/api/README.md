# API Routes

## GET /api/app?kind=public-config
Public bootstrap config for browser auth/billing initialization.

## GET /api/app?kind=runtime-config
Resolved runtime policy and entitlement-aware tier state.

## GET /api/app?kind=health
Simple deployment health/status check.

## POST /api/ai?action=anchors
Generates page anchors for the current reading passage.

## POST /api/ai?action=evaluate
Evaluates reader input against the current page.

## POST /api/ai?action=summary
Produces a final summary from page history.

## POST /api/book-import
Import/convert flow for uploaded books.

## POST /api/billing?action=checkout
Creates a backend-owned Stripe checkout session.

## POST /api/billing?action=portal
Creates a backend-owned Stripe billing portal session.

## POST /api/stripe/webhook
Stripe webhook receiver for entitlement writes.

## POST /api/tts
Server-owned TTS broker.

## POST /api/usage-check
Server-owned usage gate.

## POST /api/import-capacity
Server-owned import capacity gate.
