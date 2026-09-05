# Seoul AI Fashion Marketing — Instagram Automation Starter

## What is included
- Chrome-friendly dashboard
- Real Meta/Instagram OAuth connection starter
- One-click campaign workflow UI
- Korean/Seoul fashion modules
- 6-angle campaign planner
- Reel/caption/publishing workflow placeholders
- 9 marketing-team roles

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Put your Meta App ID and App Secret into `.env`.
4. Configure the same Redirect URI in your Meta developer app:
   `http://localhost:3000/auth/instagram/callback`
5. Run:
   `npm install`
   `npm start`
6. Open `http://localhost:3000` in Chrome.

## Important
This is a working starter, not a completed production Meta integration. Meta permissions, supported Instagram account types, OAuth scopes, review requirements, media hosting, publishing endpoints and policies can change. Verify the current Meta/Instagram developer documentation before production deployment.

Never put META_APP_SECRET in browser JavaScript. Keep it on the server.
