import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();

app.use(express.json({ limit: "20mb" }));

// ===============================
// FRONTEND
// ===============================

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});

app.use(express.static(process.cwd()));

// ===============================
// SERVER CONFIG
// ===============================

const PORT = process.env.PORT || 3000;

const BASE =
  process.env.PUBLIC_BASE_URL ||
  `http://localhost:${PORT}`;

const REDIRECT =
  process.env.META_REDIRECT_URI ||
  `${BASE}/auth/instagram/callback`;

const GRAPH_VERSION =
  process.env.INSTAGRAM_GRAPH_VERSION || "v25.0";

const GRAPH_BASE =
  `https://graph.instagram.com/${GRAPH_VERSION}`;

// ===============================
// TEMPORARY SESSION STORAGE
// ===============================

const sessions = new Map();
const oauthStates = new Map();

// ===============================
// HELPERS
// ===============================

function requireEnv(name) {
  if (
    !process.env[name] ||
    process.env[name].startsWith("YOUR_")
  ) {
    throw new Error(
      `${name} is not configured in Render Environment Variables.`
    );
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

// ===============================
// BASIC STATUS
// ===============================

app.get("/api/status", async (req, res) => {
  const configured =
    !!process.env.INSTAGRAM_ACCESS_TOKEN &&
    !!process.env.INSTAGRAM_USER_ID;

  res.json({
    ok: true,
    instagram_configured: configured,
    oauth_sessions: sessions.size,
    graph_version: GRAPH_VERSION
  });
});

// ===============================
// INSTAGRAM ACCOUNT STATUS
// ===============================

app.get("/api/instagram/status", async (req, res) => {
  try {
    requireEnv("INSTAGRAM_ACCESS_TOKEN");
    requireEnv("INSTAGRAM_USER_ID");

    const token =
      process.env.INSTAGRAM_ACCESS_TOKEN;

    const userId =
      process.env.INSTAGRAM_USER_ID;

    const url =
      `${GRAPH_BASE}/${userId}` +
      `?fields=id,username` +
      `&access_token=${encodeURIComponent(token)}`;

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({
        ok: false,
        connected: false,
        error: data
      });
    }

    res.json({
      ok: true,
      connected: true,
      instagram: data
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      connected: false,
      error: error.message
    });
  }
});

// ===============================
// INSTAGRAM OAUTH START
// ===============================

app.get("/auth/instagram", (req, res) => {
  try {
    requireEnv("META_APP_ID");

    const state =
      crypto.randomBytes(24).toString("hex");

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

  } catch (error) {
    res.status(500).send(`
      <h2>Meta setup required</h2>
      <p>${escapeHtml(error.message)}</p>
    `);
  }
});

// ===============================
// INSTAGRAM OAUTH CALLBACK
// ===============================

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
      return res.status(400).send(
        "Invalid OAuth state."
      );
    }

    oauthStates.delete(state);

    if (!code) {
      return res.status(400).send(
        "No authorization code returned."
      );
    }

    try {
      requireEnv("META_APP_ID");
      requireEnv("META_APP_SECRET");

      const body =
        new URLSearchParams({
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

      const response =
        await fetch(
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

      const data =
        await response.json();

      if (
        !response.ok ||
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

    } catch (error) {
      res.status(500).send(`
        <h2>Connection error</h2>
        <pre>${escapeHtml(
          error.message
        )}</pre>
      `);
    }
  }
);

// ===============================
// DISCONNECT
// ===============================

app.post("/api/disconnect", (req, res) => {

  const sessionId =
    req.body?.sessionId;

  if (sessionId) {
    sessions.delete(sessionId);
  }

  res.json({
    ok: true
  });
});

// ===============================
// CAMPAIGN PLAN
// ===============================

app.post("/api/generate-plan", (req, res) => {

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
      "Generate hero fashion image",
      "Create controlled fashion angles",
      "Create 10 second fashion reel",
      "Generate caption and hashtags",
      "Prepare Instagram publishing"
    ],

    status: "planned"
  });
});

// ===============================
// PUBLISH IMAGE TO INSTAGRAM
// ===============================

app.post(
  "/api/publish-image",
  async (req, res) => {

    try {

      requireEnv(
        "INSTAGRAM_ACCESS_TOKEN"
      );

      requireEnv(
        "INSTAGRAM_USER_ID"
      );

      const {
        image_url,
        caption = ""
      } = req.body;

      if (!image_url) {
        return res.status(400).json({
          ok: false,
          error:
            "image_url is required."
        });
      }

      const token =
        process.env.INSTAGRAM_ACCESS_TOKEN;

      const userId =
        process.env.INSTAGRAM_USER_ID;

      // ---------------------------
      // CREATE MEDIA CONTAINER
      // ---------------------------

      const createUrl =
        `${GRAPH_BASE}/${userId}/media`;

      const createBody =
        new URLSearchParams();

      createBody.set(
        "image_url",
        image_url
      );

      createBody.set(
        "caption",
        caption
      );

      createBody.set(
        "access_token",
        token
      );

      const createResponse =
        await fetch(
          createUrl,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body: createBody
          }
        );

      const createData =
        await createResponse.json();

      if (
        !createResponse.ok ||
        !createData.id
      ) {
        return res.status(400).json({
          ok: false,
          step: "create_media",
          error: createData
        });
      }

      const containerId =
        createData.id;

      // ---------------------------
      // PUBLISH MEDIA
      // ---------------------------

      const publishUrl =
        `${GRAPH_BASE}/${userId}/media_publish`;

      const publishBody =
        new URLSearchParams();

      publishBody.set(
        "creation_id",
        containerId
      );

      publishBody.set(
        "access_token",
        token
      );

      const publishResponse =
        await fetch(
          publishUrl,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body: publishBody
          }
        );

      const publishData =
        await publishResponse.json();

      if (!publishResponse.ok) {
        return res.status(400).json({
          ok: false,
          step: "publish_media",
          container_id:
            containerId,
          error:
            publishData
        });
      }

      res.json({
        ok: true,

        message:
          "Instagram post published successfully.",

        container_id:
          containerId,

        media_id:
          publishData.id
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });

    }
  }
);

// ===============================
// CREATE INSTAGRAM REEL
// ===============================

app.post(
  "/api/publish-reel",
  async (req, res) => {

    try {

      requireEnv(
        "INSTAGRAM_ACCESS_TOKEN"
      );

      requireEnv(
        "INSTAGRAM_USER_ID"
      );

      const {
        video_url,
        caption = ""
      } = req.body;

      if (!video_url) {
        return res.status(400).json({
          ok: false,
          error:
            "video_url is required."
        });
      }

      const token =
        process.env.INSTAGRAM_ACCESS_TOKEN;

      const userId =
        process.env.INSTAGRAM_USER_ID;

      const createUrl =
        `${GRAPH_BASE}/${userId}/media`;

      const body =
        new URLSearchParams();

      body.set(
        "media_type",
        "REELS"
      );

      body.set(
        "video_url",
        video_url
      );

      body.set(
        "caption",
        caption
      );

      body.set(
        "access_token",
        token
      );

      const response =
        await fetch(
          createUrl,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.id
      ) {
        return res.status(400).json({
          ok: false,
          step: "create_reel",
          error: data
        });
      }

      res.json({
        ok: true,

        message:
          "Reel container created.",

        container_id:
          data.id,

        note:
          "The Reel must finish processing before final publication."
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });

    }
  }
);

// ===============================
// OLD PLACEHOLDER ENDPOINT
// ===============================

app.post(
  "/api/publish-placeholder",
  async (req, res) => {

    if (req.body?.image_url) {

      return res.status(400).json({
        ok: false,

        message:
          "Use /api/publish-image for Instagram image publishing."
      });
    }

    res.status(400).json({
      ok: false,

      message:
        "Instagram publishing requires a public image_url and caption."
    });
  }
);

// ===============================
// START SERVER
// ===============================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Seoul Instagram Automation running on port ${PORT}`
    );
  }
);
