
const API_ID = "709fa152";
const API_URL = "https://api.jamendo.com/v3.0/tracks/";

const $ = id => document.getElementById(id);
const audio = $("audio");

const DB_NAME = "SONORA_Music_DB";
const STORE_NAME = "songs";

let tracks = [];
let localTracks = [];
let displayedTracks = [];
let currentTrack = null;

let view = "discover";
let searchTerm = "";
let liked = [];
let playlists = [];
let activePlaylist = null;

// 0 = Repeat Off, 1 = Repeat All, 2 = Repeat One
let repeatMode = 0;

let currentPlayRequest = 0;

// -------------------- SAVED DATA --------------------

try {
  liked = JSON.parse(localStorage.getItem("sonora-liked") || "[]");
  playlists = JSON.parse(localStorage.getItem("sonora-playlists") || "[]");
} catch {
  liked = [];
  playlists = [];
}

// -------------------- REPEAT BUTTON --------------------

function updateRepeatButton() {
  const button = $("repeatBtn");
  if (!button) return;

  const modes = [
    { icon: "↻", title: "Repeat Off" },
    { icon: "🔁", title: "Repeat All" },
    { icon: "🔂", title: "Repeat One" }
  ];

  button.textContent = modes[repeatMode].icon;
  button.title = modes[repeatMode].title;
  button.setAttribute("aria-label", modes[repeatMode].title);
  button.classList.toggle("repeat-active", repeatMode !== 0);

  audio.loop = repeatMode === 2;
}

if ($("repeatBtn")) {
  $("repeatBtn").addEventListener("click", () => {
    repeatMode = repeatMode === 0 ? 2 : repeatMode === 2 ? 1 : 0;
    updateRepeatButton();

    $("status").textContent = [
      "Repeat Off",
      "Repeat All enabled",
      "Repeat One enabled"
    ][repeatMode];
  });
}

updateRepeatButton();

// -------------------- HELPERS --------------------

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";

  return `${Math.floor(seconds / 60)}:${String(
    Math.floor(seconds % 60)
  ).padStart(2, "0")}`;
}

function getTrackKey(track) {
  return track.source === "local"
    ? track.id
    : `jamendo-${track.id}`;
}

// -------------------- VISIBLE TRACKS --------------------

function getVisibleTracks() {
  if (view === "library") {
    return [
      ...localTracks,
      ...tracks.filter(track => liked.includes(getTrackKey(track)))
    ];
  }

  if (view === "liked") {
    return [...localTracks, ...tracks].filter(track =>
      liked.includes(getTrackKey(track))
    );
  }

  if (view === "playlists") {
    const playlist = playlists.find(
      item => item.id === activePlaylist
    );

    if (!playlist) return [];

    const allTracks = [...localTracks, ...tracks];

    return playlist.ids
      .map(id => allTracks.find(track => getTrackKey(track) === id))
      .filter(Boolean);
  }

  return tracks;
}

// -------------------- INDEXEDDB MUSIC STORAGE --------------------

function openMusicDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveSongToDB(song) {
  const db = await openMusicDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).put(song);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      const error = transaction.error;
      db.close();
      reject(error);
    };

    transaction.onabort = () => {
      const error = transaction.error;
      db.close();
      reject(error || new Error("Storage transaction aborted"));
    };
  });
}

async function loadSavedSongs() {
  const db = await openMusicDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      const result = request.result;
      db.close();
      resolve(result);
    };

    request.onerror = () => {
      const error = request.error;
      db.close();
      reject(error);
    };
  });
}

async function restoreSavedSongs() {
  const savedSongs = await loadSavedSongs();

  localTracks.forEach(song => {
    if (song.url) URL.revokeObjectURL(song.url);
  });

  localTracks = savedSongs.map(song => ({
    ...song,
    url: URL.createObjectURL(song.blob)
  }));

  renderTracks();
}

// -------------------- ONLINE MUSIC --------------------

async function loadTracks(query = "") {
  searchTerm = query;

  $("status").textContent = "Finding music...";
  $("trackList").innerHTML = "";

  try {
    const params = new URLSearchParams({
      client_id: API_ID,
      format: "json",
      limit: "20",
      include: "licenses",
      audioformat: "mp32",
      imagesize: "100"
    });

    if (query) {
      params.set("search", query);
    } else {
      params.set("featured", "1");
      params.set("fuzzytags", "pop");
    }

    const response = await fetch(`${API_URL}?${params}`);

    if (!response.ok) {
      throw new Error("Music service unavailable");
    }

    const data = await response.json();

    if (data.headers?.status !== "success") {
      throw new Error(
        data.headers?.error_message || "Jamendo API error"
      );
    }

    tracks = (data.results || []).filter(track => track.audio);

    $("status").textContent = tracks.length
      ? ""
      : "No tracks found. Try another search.";

    renderTracks();
  } catch (error) {
    console.error("Online music error:", error);

    tracks = [];
    renderTracks();

    $("status").textContent =
      "Online music unavailable. Check your internet or API credentials. Saved MP3 files remain available.";
  }
}

// -------------------- RENDER SONG LIST --------------------

function renderTracks() {
  const list = getVisibleTracks();
  displayedTracks = list;

  const titles = {
    discover: searchTerm ? "Search results." : "Discover music.",
    library: "Your library.",
    liked: "Your favourites.",
    playlists: "Your playlists."
  };

  $("pageTitle").textContent = titles[view];

  $("listTitle").textContent = {
    discover: searchTerm ? `Results for "${searchTerm}"` : "Explore tracks",
    library: "Your music",
    liked: "Liked songs",
    playlists: activePlaylist
      ? playlists.find(item => item.id === activePlaylist)?.name || "Playlist"
      : "Choose a playlist"
  }[view];

  $("resultCount").textContent = `${list.length} tracks`;

  if (!list.length) {
    $("trackList").innerHTML = "";

    if (view === "playlists" && !activePlaylist) {
      $("trackList").innerHTML =
        `<button class="primary" id="createPlaylistBtn">＋ Create playlist</button>`;
      return;
    }

    $("status").textContent =
      view === "discover" && !tracks.length
        ? $("status").textContent
        : "Nothing here yet. Add MP3 files or explore music.";

    return;
  }

  $("status").textContent = "";

  const backButton = view === "playlists"
    ? `<button class="icon-btn" id="backPlaylists">← All playlists</button>`
    : "";

  $("trackList").innerHTML = backButton + list.map((track, index) => {
    const image = track.image || track.album_image || "";
    const key = getTrackKey(track);
    const isLiked = liked.includes(key);

    const allowedDownload =
      track.source !== "local" &&
      track.audiodownload_allowed === true &&
      Boolean(track.audiodownload);

    return `
      <article class="track">
        ${
          image
            ? `<img class="cover" src="${escapeHTML(image)}" alt="" loading="lazy">`
            : `<div class="cover">♫</div>`
        }

        <div class="track-info">
          <strong title="${escapeHTML(track.name)}">${escapeHTML(track.name)}</strong>
          <span>${escapeHTML(track.artist_name || "Your device")}</span>
        </div>

        <div class="track-actions">
          <button class="icon-btn" data-action="like"
            data-index="${index}" title="Like">${isLiked ? "♥" : "♡"}</button>

          <button class="icon-btn" data-action="playlist"
            data-index="${index}" title="Add to playlist">＋</button>

          ${
            allowedDownload
              ? `<a class="icon-btn download"
                   href="${escapeHTML(track.audiodownload)}"
                   download title="Download permitted track">↓</a>`
              : ""
          }

          <button class="icon-btn track-play" data-action="play"
            data-index="${index}" title="Play">▶</button>
        </div>
      </article>
    `;
  }).join("");

  $("trackList").querySelector("#backPlaylists")?.addEventListener("click", () => {
    activePlaylist = null;
    renderTracks();
  });
}

// -------------------- LIKES --------------------

function toggleLike(track) {
  const key = getTrackKey(track);

  liked = liked.includes(key)
    ? liked.filter(id => id !== key)
    : [...liked, key];

  localStorage.setItem("sonora-liked", JSON.stringify(liked));

  renderTracks();

  if (currentTrack && getTrackKey(currentTrack) === key) {
    $("likeBtn").textContent = liked.includes(key) ? "♥" : "♡";
  }
}

// -------------------- PLAY A SONG --------------------

function playTrack(track) {
  if (!track) return;

  currentTrack = track;
  currentPlayRequest++;

  $("nowTitle").textContent = track.name;
  $("nowArtist").textContent = track.artist_name || "Your music";

  $("likeBtn").textContent =
    liked.includes(getTrackKey(track)) ? "♥" : "♡";

  const image = track.image || track.album_image;

  $("nowArt").innerHTML = image
    ? `<img src="${escapeHTML(image)}" alt=""
         style="width:100%;height:100%;object-fit:cover;border-radius:8px">`
    : "♫";

  audio.loop = repeatMode === 2;
  audio.src = track.source === "local" ? track.url : track.audio;
  audio.load();

  const requestNumber = currentPlayRequest;

  audio.play()
    .then(() => {
      if (requestNumber !== currentPlayRequest) return;

      $("playBtn").textContent = "Ⅱ";
      $("status").textContent = "";
    })
    .catch(error => {
      if (requestNumber !== currentPlayRequest) return;

      console.error("Playback error:", error);
      $("playBtn").textContent = "▶";
      $("status").textContent =
        "Playback failed. Check your connection or try another track.";
    });

  renderTracks();
}

// -------------------- NEXT / PREVIOUS --------------------

function playRelative(direction) {
  if (!displayedTracks.length) return;

  let index = displayedTracks.findIndex(
    track =>
      currentTrack &&
      getTrackKey(track) === getTrackKey(currentTrack)
  );

  if (index < 0) {
    index = direction > 0 ? -1 : 0;
  }

  const nextIndex =
    (index + direction + displayedTracks.length) % displayedTracks.length;

  playTrack(displayedTracks[nextIndex]);
}

// -------------------- AUTOMATIC REPEAT --------------------

audio.addEventListener("ended", () => {
  console.log("Song ended. Current repeat mode:", repeatMode);

  if (!currentTrack) return;

  // Repeat One is handled natively by audio.loop.
  if (repeatMode === 2) return;

  // Find the current song in the visible list.
  const index = displayedTracks.findIndex(
    track => getTrackKey(track) === getTrackKey(currentTrack)
  );

  // REPEAT ALL: move to next song and wrap to the first.
  if (repeatMode === 1) {
    if (displayedTracks.length > 0) {
      if (index >= 0) {
        playTrack(displayedTracks[(index + 1) % displayedTracks.length]);
      } else {
        playTrack(displayedTracks[0]);
      }
    }

    return;
  }

  // REPEAT OFF: advance only if another song exists.
  if (index >= 0 && index < displayedTracks.length - 1) {
    playTrack(displayedTracks[index + 1]);
  }
});

// -------------------- PLAYLISTS --------------------

function createPlaylist() {
  const name = prompt("Playlist ka naam kya rakhna hai?");
  if (!name?.trim()) return;

  const playlist = {
    id: `playlist-${Date.now()}`,
    name: name.trim(),
    ids: []
  };

  playlists.push(playlist);

  localStorage.setItem("sonora-playlists", JSON.stringify(playlists));

  activePlaylist = playlist.id;

  renderPlaylistMenu();
  renderTracks();
}

function addToPlaylist(track) {
  if (!playlists.length) {
    createPlaylist();
    if (!playlists.length) return;
  }

  const choices = playlists
    .map((playlist, index) => `${index + 1}. ${playlist.name}`)
    .join("\n");

  const answer = prompt(`Playlist number choose karo:\n${choices}`);
  const index = Number(answer) - 1;

  if (!Number.isInteger(index) || !playlists[index]) return;

  const playlist = playlists[index];
  const key = getTrackKey(track);

  if (!playlist.ids.includes(key)) {
    playlist.ids.push(key);
  }

  localStorage.setItem("sonora-playlists", JSON.stringify(playlists));
  $("status").textContent = "Added to playlist ✓";
}

function renderPlaylistMenu() {
  const old = document.getElementById("playlistMenu");
  if (old) old.remove();

  const container = document.createElement("div");
  container.id = "playlistMenu";

  container.innerHTML = playlists.map(playlist => `
    <button class="nav" data-playlist-id="${escapeHTML(playlist.id)}">
      ♫ ${escapeHTML(playlist.name)}
    </button>
  `).join("") + `
    <button class="nav" id="newPlaylistBtn">＋ New playlist</button>
  `;

  $("trackList").before(container);

  container.querySelectorAll("[data-playlist-id]").forEach(button => {
    button.addEventListener("click", () => {
      view = "playlists";
      activePlaylist = button.dataset.playlistId;
      renderTracks();
    });
  });

  container.querySelector("#newPlaylistBtn")
    .addEventListener("click", createPlaylist);
}

// -------------------- SONG LIST BUTTONS --------------------

$("trackList").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const track = displayedTracks[Number(button.dataset.index)];
  if (!track) return;

  if (button.dataset.action === "play") playTrack(track);
  if (button.dataset.action === "like") toggleLike(track);
  if (button.dataset.action === "playlist") addToPlaylist(track);
});

$("trackList").addEventListener("click", event => {
  if (event.target.id === "createPlaylistBtn") {
    createPlaylist();
  }
});

// -------------------- SEARCH --------------------

$("searchForm").addEventListener("submit", event => {
  event.preventDefault();

  view = "discover";
  activePlaylist = null;

  loadTracks($("searchInput").value.trim());
});

$("exploreBtn").addEventListener("click", () => {
  view = "discover";
  activePlaylist = null;

  $("searchInput").value = "";
  loadTracks("");
});

// -------------------- NAVIGATION --------------------

document.querySelectorAll(".nav[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav[data-view]").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    view = button.dataset.view;
    activePlaylist = null;

    if (view === "discover") {
      loadTracks(searchTerm);
    } else {
      renderTracks();
    }
  });
});

// -------------------- UPLOAD LOCAL MP3 FILES --------------------

$("fileInput").addEventListener("change", async event => {
  const files = Array.from(event.target.files || []);

  try {
    for (const file of files) {
      if (!file.type.startsWith("audio/")) continue;

      const song = {
        id: `local-${file.name}-${file.size}`,
        name: file.name.replace(/\.[^/.]+$/, ""),
        artist_name: "Your device",
        source: "local",
        blob: file
      };

      await saveSongToDB(song);
    }

    await restoreSavedSongs();

    view = "library";
    activePlaylist = null;

    document.querySelectorAll(".nav[data-view]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.view === "library"
      );
    });

    renderTracks();
    $("status").textContent = "Songs saved on this device! ✓";
  } catch (error) {
    console.error("MP3 storage error:", error);
    $("status").textContent =
      "Could not save songs. Check browser storage space.";
  }

  event.target.value = "";
});

// -------------------- PLAYER CONTROLS --------------------

$("playBtn").addEventListener("click", () => {
  if (!audio.src) {
    if (displayedTracks.length) {
      playTrack(displayedTracks[0]);
    }
    return;
  }

  if (audio.paused) {
    audio.play().catch(error => console.error(error));
  } else {
    audio.pause();
  }
});

$("nextBtn").addEventListener("click", () => playRelative(1));
$("prevBtn").addEventListener("click", () => playRelative(-1));

$("likeBtn").addEventListener("click", () => {
  if (currentTrack) toggleLike(currentTrack);
});

$("volumeBar").addEventListener("input", event => {
  audio.volume = Number(event.target.value);
});

audio.volume = 0.8;

// -------------------- TIME AND SEEK BAR --------------------

audio.addEventListener("timeupdate", () => {
  $("currentTime").textContent = formatTime(audio.currentTime);
  $("duration").textContent = formatTime(audio.duration);

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    $("seekBar").value =
      (audio.currentTime / audio.duration) * 100;
  }
});

$("seekBar").addEventListener("input", event => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime =
      (Number(event.target.value) / 100) * audio.duration;
  }
});

// -------------------- PLAY / PAUSE ICONS --------------------

audio.addEventListener("pause", () => {
  $("playBtn").textContent = "▶";
});

audio.addEventListener("play", () => {
  $("playBtn").textContent = "Ⅱ";
});

audio.addEventListener("error", () => {
  if (currentTrack) {
    $("status").textContent =
      "This track could not be played. Try another song.";
  }
});

// -------------------- START SUNONA --------------------

async function startSonora() {
  try {
    await restoreSavedSongs();
  } catch (error) {
    console.error("Could not restore saved songs:", error);
    $("status").textContent = "Browser storage is unavailable.";
  }

  renderPlaylistMenu();
  loadTracks("");
}

startSonora();
