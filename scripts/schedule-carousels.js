#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ZERNIO_BASE = "https://zernio.com/api/v1";
const CAROUSEL_DIR = "/Users/alexrocha/remotion/my-video/out/carousels-v2";
const SCHEDULE_TIME = "10:00:00"; // 10 AM ET
const TIMEZONE = "America/New_York";

// Weekdays only, starting May 9 2026
const SCHEDULE_DATES = [
  "2026-05-09", // Fri
  "2026-05-12", // Mon
  "2026-05-13", // Tue
  "2026-05-14", // Wed
  "2026-05-15", // Thu
  "2026-05-16", // Fri
  "2026-05-19", // Mon
  "2026-05-20", // Tue
  "2026-05-21", // Wed
  "2026-05-22", // Thu
];

async function main() {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    const keysPath = path.join(
      process.env.HOME,
      "Library/Application Support/Claude/API/keys.env"
    );
    if (fs.existsSync(keysPath)) {
      const lines = fs.readFileSync(keysPath, "utf8").split("\n");
      for (const line of lines) {
        const match = line.match(/^ZERNIO_API_KEY=(.+)/);
        if (match) {
          process.env.ZERNIO_API_KEY = match[1].trim().replace(/^['"]|['"]$/g, "");
          break;
        }
      }
    }
  }

  const key = process.env.ZERNIO_API_KEY;
  if (!key) {
    console.error("ZERNIO_API_KEY not found. Set it or add to keys.env.");
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  // 1. List connected accounts
  console.log("Fetching connected accounts...");
  const accountsRes = await fetch(`${ZERNIO_BASE}/accounts`, { headers });
  let accounts = [];
  if (accountsRes.ok) {
    const data = await accountsRes.json();
    accounts = data.accounts || data || [];
  }

  if (!accounts.length) {
    console.log("Could not auto-detect accounts. Using default Mastodon Marketing account.");
    accounts = [{ _id: "69f3ab384c40d1b1ba6da254", platform: "linkedin" }];
  }

  // Filter to platforms that support image carousels
  const skipPlatforms = ["tiktok", "snapchat", "whatsapp", "youtube"];
  const compatibleAccounts = accounts.filter(
    (a) => !skipPlatforms.includes(a.platform)
  );

  console.log(
    `Found ${compatibleAccounts.length} compatible accounts:`,
    compatibleAccounts.map((a) => `${a.platform} (${a._id})`).join(", ")
  );

  // 2. Read captions
  const captionsPath = path.join(CAROUSEL_DIR, "captions.json");
  const captions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));

  // 3. Process each carousel
  for (let i = 0; i < captions.carousels.length; i++) {
    const carousel = captions.carousels[i];
    const scheduleDate = SCHEDULE_DATES[i];
    if (!scheduleDate) {
      console.log(`No schedule date for carousel ${i + 1}, skipping.`);
      continue;
    }

    const carouselDir = path.join(CAROUSEL_DIR, carousel.slug);
    if (!fs.existsSync(carouselDir)) {
      console.error(`Directory not found: ${carouselDir}`);
      continue;
    }

    // Find image files (sorted)
    const imageFiles = fs
      .readdirSync(carouselDir)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort();

    if (!imageFiles.length) {
      console.error(`No images found in ${carouselDir}`);
      continue;
    }

    console.log(
      `\n[${i + 1}/10] ${carousel.title} (${imageFiles.length} slides) → ${scheduleDate}`
    );

    // Upload each image
    const mediaItems = [];
    for (const file of imageFiles) {
      const filePath = path.join(carouselDir, file);
      const ext = path.extname(file).toLowerCase();
      const contentType =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";

      // Presign
      const presignRes = await fetch(`${ZERNIO_BASE}/media/presign`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          filename: file,
          contentType,
        }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.text();
        console.error(`  Presign failed for ${file}: ${err}`);
        continue;
      }

      const presign = await presignRes.json();

      // Upload to presigned URL
      const fileBuffer = fs.readFileSync(filePath);
      const uploadRes = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: fileBuffer,
      });

      if (!uploadRes.ok) {
        console.error(`  Upload failed for ${file}: ${uploadRes.status}`);
        continue;
      }

      mediaItems.push({ type: "image", url: presign.publicUrl });
      process.stdout.write(`  ✓ ${file}\n`);
    }

    if (!mediaItems.length) {
      console.error("  No images uploaded, skipping post creation.");
      continue;
    }

    // Build platforms array (limit X/Twitter to 4 images)
    const platforms = compatibleAccounts.map((a) => {
      const entry = { platform: a.platform, accountId: a._id };
      if (a.platform === "twitter" && mediaItems.length > 4) {
        entry.customMedia = mediaItems.slice(0, 4);
      }
      if (a.platform === "linkedin") {
        entry.platformSpecificData = {
          documentTitle: carousel.title,
        };
      }
      return entry;
    });

    // Create scheduled post
    const scheduledFor = `${scheduleDate}T${SCHEDULE_TIME}`;
    const postBody = {
      content: carousel.caption,
      mediaItems,
      platforms,
      scheduledFor,
      timezone: TIMEZONE,
    };

    const postRes = await fetch(`${ZERNIO_BASE}/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify(postBody),
    });

    if (!postRes.ok) {
      const err = await postRes.text();
      console.error(`  Post creation failed: ${err}`);
      continue;
    }

    const postData = await postRes.json();
    console.log(
      `  ✓ Scheduled for ${scheduleDate} at ${SCHEDULE_TIME} ET → ${postData.post?._id || "OK"}`
    );
  }

  console.log("\nDone! All carousels scheduled.");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
