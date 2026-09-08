/*
  PHOTO TIMELINE CONFIGURATION
  ----------------------------
  repository: your GitHub "owner/repo"
  branch:     the branch to read from
  folder:     the folder inside the repo that holds the photos
  pollMs:     how often (ms) to check GitHub for new photos
*/

const CONFIG = {
  repository: "redvr777/GameDocument",
  branch: "main",
  folder: "Documents",
  pollMs: 15000
};

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif)$/i;

const timeline = document.getElementById("timeline");
const statusText = document.getElementById("status");
const empty = document.getElementById("empty");
const errorBox = document.getElementById("error");
const errorText = document.getElementById("error-text");

const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxCaption = document.getElementById("lightbox-caption");

let photos = [];          // currently rendered photos, oldest -> newest
let currentIndex = -1;
let isFirstLoad = true;
let isSyncing = false;

function rawUrl(path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${CONFIG.repository}/${CONFIG.branch}/${encodedPath}`;
}

function apiUrl() {
  const folder = CONFIG.folder
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  return `https://api.github.com/repos/${CONFIG.repository}/contents/${folder}?ref=${encodeURIComponent(CONFIG.branch)}`;
}

function isValidConfig() {
  return !CONFIG.repository.includes("YOUR_GITHUB_") &&
         CONFIG.repository.includes("/");
}

// Turns a filename into a human-readable description.
// "sunset_at_the_lake.jpg"  -> "Sunset at the lake"
// "Boss-Fight-Concept-2.png" -> "Boss fight concept 2"
function describeFromFilename(filename) {
  const withoutExt = filename.replace(IMAGE_EXTENSIONS, "");
  const spaced = withoutExt.replace(/[_-]+/g, " ").trim();
  if (!spaced) return filename;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

async function getFilesFromGitHub() {
  const response = await fetch(apiUrl(), {
    headers: { "Accept": "application/vnd.github+json" }
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("GitHub API rate limit reached. Try again in a bit.");
    }
    if (response.status === 404) {
      throw new Error("Repository or Documents folder was not found. Check CONFIG in script.js.");
    }
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }

  const items = await response.json();

  // Expects images directly inside the configured folder.
  // Non-image files are ignored.
  return items.filter(item =>
    item.type === "file" && IMAGE_EXTENSIONS.test(item.name)
  );
}

async function readTakenDate(url, fallbackName) {
  try {
    // exifr reads EXIF from the image itself. DateTimeOriginal is preferred
    // because it represents when a camera/phone took the picture.
    const exif = await exifr.parse(url, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"]
    });

    const date = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    if (date instanceof Date && !isNaN(date.getTime())) return date;
    if (typeof date === "string") {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  } catch (_) {
    // Some images have no EXIF or block cross-origin metadata reads.
  }

  // Last resort: use a date encoded in the filename if one exists.
  // Examples: 2026-09-08_photo.jpg or IMG_20260908_143000.jpg
  const match = fallbackName.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)/);
  if (match) {
    const d = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    );
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function createCard(photo, index) {
  const card = document.createElement("article");
  card.className = "photo-card" + (photo.isNew ? " is-new" : "");
  card.tabIndex = 0;
  card.setAttribute("aria-label", `Open ${photo.description}`);

  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.src = photo.url;
  img.alt = photo.description;
  img.onerror = () => {
    card.remove();
  };

  const info = document.createElement("div");
  info.className = "photo-info";

  const time = document.createElement("div");
  time.className = "photo-time";
  time.textContent = photo.date
    ? formatTime(photo.date)
    : "Date not found";

  const name = document.createElement("div");
  name.className = "photo-name";
  name.textContent = photo.description;

  info.append(time, name);
  card.append(img, info);

  card.addEventListener("click", () => openLightbox(index));
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openLightbox(index);
    }
  });

  return card;
}

function render() {
  timeline.innerHTML = "";

  const dated = photos.filter(p => p.date);
  const undated = photos.filter(p => !p.date);

  const groups = new Map();

  for (const photo of dated) {
    const key = photo.date.toLocaleDateString("en-CA");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(photo);
  }

  for (const [_, group] of groups) {
    const day = document.createElement("section");
    day.className = "day";

    const heading = document.createElement("h2");
    heading.className = "date";
    heading.textContent = formatDate(group[0].date);

    const grid = document.createElement("div");
    grid.className = "photos";

    for (const photo of group) {
      const index = photos.indexOf(photo);
      grid.appendChild(createCard(photo, index));
    }

    day.append(heading, grid);
    timeline.appendChild(day);
  }

  if (undated.length) {
    const day = document.createElement("section");
    day.className = "day";

    const heading = document.createElement("h2");
    heading.className = "date";
    heading.textContent = "Date unknown";

    const grid = document.createElement("div");
    grid.className = "photos";

    for (const photo of undated) {
      const index = photos.indexOf(photo);
      grid.appendChild(createCard(photo, index));
    }

    day.append(heading, grid);
    timeline.appendChild(day);
  }

  // "isNew" only drives the entrance animation once.
  photos.forEach(p => { p.isNew = false; });
}

function openLightbox(index) {
  currentIndex = index;
  const photo = photos[currentIndex];

  lightboxImage.src = photo.url;
  lightboxImage.alt = photo.description;
  lightboxCaption.textContent = photo.date
    ? `${photo.description} — ${formatDate(photo.date)} • ${formatTime(photo.date)}`
    : photo.description;

  lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightboxImage.src = "";
  document.body.style.overflow = "";
}

function moveLightbox(amount) {
  if (!photos.length) return;
  currentIndex = (currentIndex + amount + photos.length) % photos.length;
  openLightbox(currentIndex);
}

document.getElementById("close-lightbox").addEventListener("click", closeLightbox);
document.getElementById("prev-photo").addEventListener("click", () => moveLightbox(-1));
document.getElementById("next-photo").addEventListener("click", () => moveLightbox(1));

lightbox.addEventListener("click", event => {
  if (event.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", event => {
  if (lightbox.classList.contains("hidden")) return;

  if (event.key === "Escape") closeLightbox();
  if (event.key === "ArrowLeft") moveLightbox(-1);
  if (event.key === "ArrowRight") moveLightbox(1);
});

function setStatus(message, { live = true } = {}) {
  statusText.innerHTML = "";
  if (live) {
    const dot = document.createElement("span");
    dot.className = "dot";
    statusText.appendChild(dot);
  }
  statusText.append(document.createTextNode(message));
}

async function buildPhoto(file) {
  const url = rawUrl(file.path);
  const date = await readTakenDate(url, file.name);

  return {
    name: file.name,
    path: file.path,
    description: describeFromFilename(file.name),
    url,
    date
  };
}

// Fetches the current file list from GitHub, adds any photos that aren't
// already shown, drops any that were removed from the repo, and re-renders
// only when something actually changed.
async function sync() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const files = await getFilesFromGitHub();
    const currentPaths = new Set(photos.map(p => p.path));
    const latestPaths = new Set(files.map(f => f.path));

    const newFiles = files.filter(f => !currentPaths.has(f.path));
    const removedPaths = [...currentPaths].filter(p => !latestPaths.has(p));

    if (isFirstLoad) {
      setStatus(`Finding photos…`);
    }

    let changed = removedPaths.length > 0;

    if (newFiles.length) {
      const newPhotos = await Promise.all(newFiles.map(async file => {
        const photo = await buildPhoto(file);
        photo.isNew = !isFirstLoad; // don't animate the very first batch
        return photo;
      }));
      photos.push(...newPhotos);
      changed = true;
    }

    if (removedPaths.length) {
      photos = photos.filter(p => !removedPaths.includes(p.path));
    }

    if (changed || isFirstLoad) {
      photos.sort((a, b) => {
        if (!a.date && !b.date) return a.name.localeCompare(b.name);
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date - b.date;
      });

      render();

      if (!photos.length) {
        empty.classList.remove("hidden");
      } else {
        empty.classList.add("hidden");
      }
    }

    errorBox.classList.add("hidden");

    const datedCount = photos.filter(p => p.date).length;
    const base = photos.length
      ? `${photos.length} photo${photos.length === 1 ? "" : "s"} • oldest to newest` +
        (datedCount < photos.length ? ` • ${photos.length - datedCount} without a date` : "")
      : "0 photos";

    setStatus(`${base} • synced ${formatTime(new Date())}`);
  } catch (error) {
    console.error(error);
    if (isFirstLoad) {
      setStatus("Unable to load archive", { live: false });
      errorText.textContent = error.message;
      errorBox.classList.remove("hidden");
    }
    // On later polls, a transient error (e.g. rate limit) is logged but
    // doesn't disrupt what's already on screen.
  } finally {
    isFirstLoad = false;
    isSyncing = false;
  }
}

async function start() {
  if (!isValidConfig()) {
    setStatus("Configure your GitHub repository in script.js", { live: false });
    errorText.textContent =
      'Open script.js and replace CONFIG.repository with something like "myname/photo-archive".';
    errorBox.classList.remove("hidden");
    return;
  }

  await sync();
  setInterval(sync, CONFIG.pollMs);
}

start();
