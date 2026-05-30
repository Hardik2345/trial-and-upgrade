# Spin The Wheel Campaign Platform

JavaScript monorepo for a multi-tenant Shopify campaign backend and admin funnel dashboard.

## Apps

- `apps/api`: Express API, MongoDB models, JWT authentication, Shopify/OTP/Flits services, Socket.IO.
- `apps/dashboard`: Vite React admin dashboard for funnel analytics.

## Quick Start

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:api
npm run dev:dashboard
```

Create the first super admin:

```bash
npm run create-admin --workspace apps/api -- admin@example.com password123 "Admin"
```

The customer journey is API-only. No storefront frontend is included.
