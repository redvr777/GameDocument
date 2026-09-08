/*
  PHOTO TIMELINE CONFIGURATION
  ----------------------------
  Change these three values to match your GitHub repository.

  Example:
    repository: "jil-cois/photo-archive"
    branch: "main"
    folder: "photos"
*/

const CONFIG = {
  repository: "YOUR_GITHUB_USERNAME/YOUR_REPOSITORY",
  branch: "main",
  folder: "photos"
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

let photos = [];
let currentIndex = -1;

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

async function getFilesFromGitHub() {
  const response = await fetch(apiUrl(), {
    headers: { "Accept": "application/vnd.github+json" }
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("GitHub API rate limit reached. Try again later.");
    }
    if (response.status === 404) {
      throw new Error("Repository or photos folder was not found. Check CONFIG in script.js.");
    }
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }

  const items = await response.json();

  // This version expects images directly inside the configured folder.
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
  card.className = "photo-card";
  card.tabIndex = 0;
  card.setAttribute("aria-label", `Open ${photo.name}`);

  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.src = photo.url;
  img.alt = photo.name;
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
  name.textContent = photo.name;

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

  let globalIndex = 0;

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
      globalIndex++;
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
}

function openLightbox(index) {
  currentIndex = index;
  const photo = photos[currentIndex];

  lightboxImage.src = photo.url;
  lightboxImage.alt = photo.name;
  lightboxCaption.textContent = photo.date
    ? `${formatDate(photo.date)} • ${formatTime(photo.date)}`
    : photo.name;

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

async function load() {
  if (!isValidConfig()) {
    statusText.textContent = "Configure your GitHub repository in script.js";
    errorText.textContent =
      'Open script.js and replace "YOUR_GITHUB_USERNAME/YOUR_REPOSITORY" with something like "myname/photo-archive".';
    errorBox.classList.remove("hidden");
    return;
  }

  try {
    statusText.textContent = "Finding photos…";

    const files = await getFilesFromGitHub();

    if (!files.length) {
      statusText.textContent = "0 photos";
      empty.classList.remove("hidden");
      return;
    }

    statusText.textContent = `Reading dates from ${files.length} photo${files.length === 1 ? "" : "s"}…`;

    const results = await Promise.all(
      files.map(async file => {
        const url = rawUrl(file.path);
        const date = await readTakenDate(url, file.name);

        return {
          name: file.name,
          path: file.path,
          url,
          date
        };
      })
    );

    // Oldest first. Undated photos go last.
    results.sort((a, b) => {
      if (!a.date && !b.date) return a.name.localeCompare(b.name);
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date - b.date;
    });

    photos = results;
    render();

    const datedCount = photos.filter(p => p.date).length;
    statusText.textContent =
      `${photos.length} photo${photos.length === 1 ? "" : "s"} • oldest to newest` +
      (datedCount < photos.length ? ` • ${photos.length - datedCount} without a date` : "");
  } catch (error) {
    console.error(error);
    statusText.textContent = "Unable to load archive";
    errorText.textContent = error.message;
    errorBox.classList.remove("hidden");
  }
}

load();
