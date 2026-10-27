// Convex verifies the tokens the sign-in code in convex/auth.ts signs against the public key that
// convex/http.ts serves at `<CONVEX_SITE_URL>/.well-known/jwks.json`. CONVEX_SITE_URL is set by
// Convex itself on every deployment.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
