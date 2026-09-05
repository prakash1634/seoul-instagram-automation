import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();

app.use(express.json({ limit: "10mb" }));

// index.html GitHub repository के root में है
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});

// बाकी static files
app.use(express.static(process.cwd()));

const PORT = process.env.PORT || 3000;
const BASE =
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const REDIRECT =
  process.env.META_REDIRECT_URI ||
  `${BASE}/auth/instagram/callback`;

const sessions = new Map();
const oauthStates = new Map();

function requireEnv(name) {
  if (
    !process.env[name] ||
    process.env[name].startsWith("YOUR_")
  ) {
    throw new Error(
      `${name} is not configured. Add your Meta credentials in Render Environment Variables.`
    );
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// Status
app.get("/api/status", (req, res) => {
  res.json({
    connected: sessions.size > 0
  });
});

// Instagram Connect
app.get("/auth/instagram", (req, res) => {
  try {
    requireEnv("META_APP_ID");

    const state = crypto.randomBytes(24).toString("hex");
    oauthStates.set(state, Date.now());

    const scopes =
      process.env.INSTAGRAM_SCOPES ||
      "instagram_business_basic,instagram_business_content_publish";

    const url = new URL(
      "https://www.instagram.com/oauth/authorize"
    );

    url.searchParams.set(
      "client_id",
      process.env.META_APP_ID
    );

    url.searchParams.set(
      "redirect_uri",
      REDIRECT
    );

    url.searchParams.set(
      "response_type",
      "code"
    );

    url.searchParams.set(
      "scope",
      scopes
    );

    url.searchParams.set(
      "state",
      state
    );

    res.redirect(url.toString());

  } catch (e) {
    res.status(500).send(`
      <h2>Meta setup required</h2>
      <p>${escapeHtml(e.message)}</p>
    `);
  }
});

// Instagram Callback
app.get(
  "/auth/instagram/callback",
  async (req, res) => {

    const {
      code,
      state,
      error,
      error_reason
    } = req.query;

    if (error) {
      return res.status(400).send(
        `Instagram authorization failed: ${
          error_reason || error
        }`
      );
    }

    if (
      !state ||
      !oauthStates.has(state)
    ) {
      return res
        .status(400)
        .send("Invalid OAuth state.");
    }

    oauthStates.delete(state);

    if (!code) {
      return res
        .status(400)
        .send("No authorization code returned.");
    }

    try {

      requireEnv("META_APP_ID");
      requireEnv("META_APP_SECRET");

      const body = new URLSearchParams({
        client_id:
          process.env.META_APP_ID,

        client_secret:
          process.env.META_APP_SECRET,

        grant_type:
          "authorization_code",

        redirect_uri:
          REDIRECT,

        code
      });

      const r = await fetch(
        "https://api.instagram.com/oauth/access_token",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          body
        }
      );

      const data = await r.json();

      if (
        !r.ok ||
        !data.access_token
      ) {
        return res.status(400).send(`
          <h2>Instagram token exchange failed</h2>
          <pre>${escapeHtml(
            JSON.stringify(data, null, 2)
          )}</pre>
        `);
      }

      const sessionId =
        crypto.randomBytes(24).toString("hex");

      sessions.set(sessionId, {
        access_token:
          data.access_token,

        user_id:
          data.user_id,

        created_at:
          Date.now()
      });

      res.send(`
        <script>
          localStorage.setItem(
            "ig_session",
            "${sessionId}"
          );

          location.href="/?connected=1";
        </script>
      `);

    } catch (e) {

      res.status(500).send(`
        <h2>Connection error</h2>
        <pre>${escapeHtml(
          e.message
        )}</pre>
      `);
    }
  }
);

// Disconnect
app.post(
  "/api/disconnect",
  (req, res) => {

    const sid =
      req.body.sessionId;

    if (sid) {
      sessions.delete(sid);
    }

    res.json({
      ok: true
    });
  }
);

// AI Fashion Plan
app.post(
  "/api/generate-plan",
  (req, res) => {

    const {
      prompt,
      angles = 6
    } = req.body;

    res.json({

      prompt:
        prompt ||
        "Korean Seoul luxury fashion editorial",

      angles,

      steps: [
        "Generate AI fashion image",
        "Create 6 controlled fashion angles",
        "Create 10 second fashion reel",
        "Generate caption and hashtags",
        "Prepare Instagram publishing"
      ],

      status:
        "planned"
    });
  }
);

// Instagram publishing placeholder
app.post(
  "/api/publish-placeholder",
  (req, res) => {

    res.status(501).json({

      ok: false,

      message:
        "Instagram publishing will be enabled after Meta App configuration, permissions and media hosting are completed."

    });
  }
);

// Start
app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Seoul Instagram Automation running on port ${PORT}`
    );
  }
);
