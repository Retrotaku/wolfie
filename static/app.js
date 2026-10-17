const minimumPlayers = Number(document.querySelector("main").dataset.minimumPlayers);
const maximumPlayers = Number(document.querySelector("main").dataset.maximumPlayers);
const optionsPanel = document.querySelector("#lobby-options");
const lobbyPanel = document.querySelector("#lobby-view");
const roomWorkspace = document.querySelector("#room-workspace");
const lobbyStatus = document.querySelector("#lobby-status");
const setupStatus = document.querySelector("#setup-status");
const modeChoices = document.querySelector("#mode-choices");
const modePanels = {
  local: document.querySelector("#local-panel"),
  online: document.querySelector("#online-panel"),
};
const compositionPanel = document.querySelector("#composition-panel");
const compositionStatus = document.querySelector("#composition-status");
const compositionInputs = [...document.querySelectorAll("[data-role]")];
const roleLabels = {
  voyante: "Voyante",
  sorciere: "Sorcière",
  cupidon: "Cupidon",
  chasseur: "Chasseur",
  loup_enrage: "Loup Enragé",
  loup_blanc: "Loup Blanc",
};
let activeRoom = null;
let activeRoomView = null;
let pollTimer = null;
let compositionDirty = false;
let onlineRoleLoaded = false;
let localGameStarted = false;
const revealedLocalPlayers = new Set();
let selectedLocalPlayer = null;

const playerCountSelect = document.querySelector("#local-player-count");
const playerFields = document.querySelector("#local-player-fields");
const playerNameEntry = document.querySelector("#player-name-entry");
const playerNameInput = document.querySelector("#player-name-input");
let activePlayerIndex = null;

function renderLocalPlayerFields() {
  const savedNames = [...playerFields.querySelectorAll("[data-player-name]")]
    .map((tile) => tile.dataset.playerName || "");
  const count = Number(playerCountSelect.value);
  const previousNames = Array.from({ length: count }, (_, index) => savedNames[index] || "");
  playerFields.replaceChildren();
  if (activePlayerIndex !== null && activePlayerIndex >= count) {
    activePlayerIndex = null;
    playerNameEntry.hidden = true;
    playerFields.hidden = false;
  }
  for (let index = 0; index < count; index += 1) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "player-card";
    tile.disabled = Boolean(previousNames[index]);
    tile.dataset.playerIndex = String(index);
    tile.dataset.playerName = previousNames[index] || "";
    tile.setAttribute("aria-label", previousNames[index]
      ? `Modifier le pseudo de ${previousNames[index]}`
      : `Saisir le pseudo du joueur ${index + 1}`);
    if (previousNames[index]) {
      tile.classList.add("player-card-complete");
      const initial = document.createElement("span");
      initial.className = "player-card-initial";
      initial.textContent = previousNames[index].charAt(0).toLocaleUpperCase("fr");
      const playerNumber = document.createElement("span");
      playerNumber.className = "player-card-number";
      playerNumber.textContent = previousNames[index];
      tile.append(initial, playerNumber);
    } else {
      const image = document.createElement("img");
      image.className = "player-card-emblem";
      image.src = "/resources/cartes/icone.jpeg";
      image.alt = "";
      image.setAttribute("aria-hidden", "true");
      tile.append(image);
    }
    tile.addEventListener("click", () => openPlayerNameEntry(index));
    playerFields.append(tile);
  }
  const completedCount = previousNames.filter(Boolean).length;
  document.querySelector("#name-entry-progress-count").textContent = `${completedCount}/${count}`;
  document.querySelector("#name-entry-progress-fill").style.width =
    `${(completedCount / count) * 100}%`;
}

function openPlayerNameEntry(index) {
  const tile = playerFields.querySelector(`[data-player-index="${index}"]`);
  if (tile.dataset.playerName) return;
  activePlayerIndex = index;
  playerNameInput.value = tile.dataset.playerName;
  document.querySelector("#player-name-title").textContent =
    "Saisis ton pseudo pour dévoiler ton rôle";
  playerFields.hidden = true;
  playerNameEntry.hidden = false;
  document.querySelector("#local-form").classList.add("editing-player-name");
  playerNameInput.focus();
}

function closePlayerNameEntry() {
  activePlayerIndex = null;
  playerNameEntry.hidden = true;
  playerFields.hidden = false;
  document.querySelector("#local-form").classList.remove("editing-player-name");
}

async function savePlayerName() {
  if (activePlayerIndex === null) return;
  const name = playerNameInput.value.trim();
  if (!name) {
    playerNameInput.setCustomValidity("Saisis un pseudo pour ce joueur.");
    playerNameInput.reportValidity();
    return;
  }
  playerNameInput.setCustomValidity("");
  const playerIndex = activePlayerIndex;
  const playerCount = Number(playerCountSelect.value);
  const saveButton = document.querySelector("#save-player-name");
  saveButton.disabled = true;
  try {
    let room;
    if (!activeRoom) {
      const placeholders = Array.from(
        { length: playerCount },
        (_, index) => `Joueur ${String(index + 1).padStart(2, "0")}`,
      );
      const createdRoom = await postJson("/api/rooms", {
        mode: "local",
        players: placeholders,
      });
      room = await postJson(`/api/rooms/${encodeURIComponent(createdRoom.code)}/start`, {});
      activeRoom = room.code;
      activeRoomView = room;
      revealedLocalPlayers.clear();
      playerCountSelect.disabled = true;
      document.querySelector("#player-name-back").disabled = true;
    }
    const roomCode = activeRoom || room.code;
    const updatedRoom = await postJson(
      `/api/rooms/${encodeURIComponent(roomCode)}/players/${playerIndex}/name`,
      { name },
    );
    closePlayerNameEntry();
    setupStatus.textContent = "";
    activeRoom = updatedRoom.code;
    showLobby(updatedRoom);
    openLocalRoleCard(playerIndex);
  } catch (error) {
    setupStatus.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
}

playerCountSelect.addEventListener("change", renderLocalPlayerFields);
renderLocalPlayerFields();
document.querySelector("#local-form").addEventListener("submit", (event) => {
  event.preventDefault();
  savePlayerName();
});
document.querySelector("#player-name-back").addEventListener("click", closePlayerNameEntry);
playerNameInput.addEventListener("input", () => playerNameInput.setCustomValidity(""));

function chooseMode(mode) {
  modeChoices.hidden = true;
  modePanels.local.hidden = mode !== "local";
  modePanels.online.hidden = mode !== "online";
}

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => chooseMode(button.dataset.mode));
});

document.querySelectorAll(".mode-back").forEach((button) => {
  button.addEventListener("click", () => {
    modePanels.local.hidden = true;
    modePanels.online.hidden = true;
    modeChoices.hidden = false;
    setupStatus.textContent = "";
  });
});

async function postJson(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Une erreur est survenue.");
  return result;
}

function showLobby(room) {
  activeRoom = room.code;
  activeRoomView = room;
  localGameStarted = false;
  revealedLocalPlayers.clear();
  compositionDirty = false;
  onlineRoleLoaded = false;
  const onlineRoom = room.mode === "online";
  roomWorkspace.classList.toggle("online-room-open", onlineRoom);
  optionsPanel.hidden = !onlineRoom;
  if (onlineRoom) {
    modeChoices.hidden = true;
    modePanels.local.hidden = true;
    modePanels.online.hidden = false;
  }
  lobbyPanel.hidden = false;
  lobbyStatus.textContent = "";
  renderRoom(room);
  if (pollTimer) window.clearInterval(pollTimer);
  if (room.mode === "online" && !room.started) {
    pollTimer = window.setInterval(refreshRoom, 2000);
  }
  if (room.started) initializeRoleReveal(room);
}

function renderComposition(room) {
  const counts = room.composition;
  const ready = room.player_count >= minimumPlayers && room.player_count <= maximumPlayers;
  compositionPanel.hidden = room.started || !ready;
  if (!counts || !ready || room.started) return;

  const canEdit = room.is_host;
  document.querySelector("#composition-count").textContent =
    `${counts.special_count} rôle${counts.special_count > 1 ? "s" : ""} spécial${counts.special_count > 1 ? "aux" : ""}`;
  for (const input of compositionInputs) {
    input.disabled = !canEdit;
    if (!compositionDirty) {
      input.checked = counts.special_roles.includes(input.dataset.role)
        || counts.wolf_roles.includes(input.dataset.role);
    }
  }
  document.querySelector("#save-composition").hidden = !canEdit;
  document.querySelector("#save-composition").disabled = !compositionDirty;
  compositionStatus.textContent = compositionDirty
    ? "Modifications non validées."
    : room.composition_customized ? "Composition personnalisée." : "Composition proposée automatiquement.";
  updateCompositionPreview();
}

function selectedComposition() {
  const selected = compositionInputs.filter((input) => input.checked).map((input) => input.dataset.role);
  return {
    special_roles: selected.filter((role) => role in roleLabels && !role.startsWith("loup_")),
    wolf_roles: selected.filter((role) => role.startsWith("loup_")),
  };
}

function updateCompositionPreview() {
  if (!activeRoomView?.composition) return;
  const composition = selectedComposition();
  const specialCount = composition.special_roles.length;
  const wolfCount = Math.floor((activeRoomView.player_count - specialCount) / 2);
  const villagerCount = activeRoomView.player_count - specialCount - wolfCount;
  const summary = document.querySelector("#composition-summary");
  const invalid = wolfCount < 1 || composition.wolf_roles.length > wolfCount;
  summary.textContent = [
    `${wolfCount} loup${wolfCount > 1 ? "s" : ""}`,
    `${villagerCount} villageois`,
    ...composition.special_roles.map((role) => roleLabels[role]),
    ...composition.wolf_roles.map((role) => roleLabels[role]),
  ].join(" · ");
  summary.classList.toggle("invalid-composition", invalid);
  document.querySelector("#save-composition").disabled = !compositionDirty || invalid;
  const startButton = document.querySelector("#start-game");
  startButton.disabled = compositionDirty || invalid || !activeRoomView.can_start;
  if (invalid) compositionStatus.textContent = "Retire une variante de loup : il n’y a pas assez de places dans la meute.";
}

function renderRoom(room) {
  activeRoomView = room;
  lobbyPanel.classList.toggle("local-reveal-mode", room.mode === "local" && room.started);
  document.querySelector("#room-mode").textContent =
    room.mode === "local" ? "PARTIE LOCALE" : "SALON EN LIGNE";
  document.querySelector("#room-title").textContent =
    room.started ? "Le village se réveille" : "Le village se rassemble";
  document.querySelector("#room-code-display").textContent = room.code;
  document.querySelector("#player-count").textContent =
    `${room.player_count} / ${maximumPlayers} joueurs`;
  const list = document.querySelector("#player-list");
  list.replaceChildren();
  room.players.forEach((player, index) => {
    const item = document.createElement("li");
    item.className = "player-item";
    const number = document.createElement("span");
    number.className = "player-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.textContent = player.name;
    const ready = document.createElement("span");
    ready.className = "player-ready";
    ready.textContent = room.mode === "online"
      ? player.online
        ? player.ready ? "PRÊT" : "EN ATTENTE"
        : "HORS LIGNE"
      : "PRÉSENT";
    item.append(number, name, ready);
    list.append(item);
  });
  const startButton = document.querySelector("#start-game");
  startButton.hidden = !room.is_host
    || room.player_count < minimumPlayers
    || room.player_count > maximumPlayers
    || room.started;
  startButton.disabled = compositionDirty || !room.can_start;
  const readyToggle = document.querySelector("#ready-toggle");
  readyToggle.hidden = room.mode !== "online" || room.started;
  readyToggle.textContent = room.viewer_ready ? "Annuler : pas prêt" : "Me mettre prêt";
  document.querySelector("#waiting-message").hidden = room.started;
  document.querySelector("#game-placeholder").hidden = !room.started;
  const waiting = document.querySelector("#waiting-message");
  if (room.player_count < minimumPlayers) {
    waiting.textContent = `Il faut encore ${minimumPlayers - room.player_count} joueur${minimumPlayers - room.player_count > 1 ? "s" : ""} pour commencer.`;
  } else if (room.mode === "online" && !room.host_online) {
    waiting.textContent = "La personne hôte doit être présente pour lancer la partie.";
  } else if (room.mode === "online" && !room.all_ready) {
    waiting.textContent = "En attente que tous les joueurs se mettent prêts.";
  } else if (room.is_host) {
    waiting.textContent = room.mode === "online"
      ? "Tout le monde est prêt. Vérifie la composition puis lance la partie."
      : "Vérifie la composition proposée, puis lance la partie.";
  } else {
    waiting.textContent = room.mode === "online"
      ? "Tout le monde est prêt. La personne hôte peut lancer la partie."
      : "La personne hôte prépare la composition des rôles.";
  }
  renderComposition(room);
}

function showRole(role) {
  const revealed = document.querySelector("#revealed-role");
  const image = document.querySelector("#role-image");
  image.src = role.image;
  image.alt = `Carte ${role.name}`;
  image.hidden = false;
  document.querySelector("#role-name").textContent = role.name;
  document.querySelector("#role-description").textContent = role.description;
  revealed.hidden = false;
}

function initializeRoleReveal(room) {
  const title = document.querySelector("#role-reveal-title");
  const instruction = document.querySelector("#role-reveal-instruction");
  document.querySelector("#revealed-role").hidden = true;
  if (room.mode === "local") {
    document.querySelector("#online-role-flow").hidden = true;
    document.querySelector("#local-role-flow").hidden = false;
    renderLocalRoleBoard();
    return;
  }
  document.querySelector("#online-role-flow").hidden = false;
  document.querySelector("#local-role-flow").hidden = true;
  title.textContent = "Ton rôle secret";
  instruction.textContent = "Seule ta carte personnelle est affichée sur cet appareil.";
  if (!onlineRoleLoaded) {
    onlineRoleLoaded = true;
    fetch(`/api/rooms/${encodeURIComponent(room.code)}/role`)
      .then(async (response) => {
        const role = await response.json();
        if (!response.ok) throw new Error(role.error || "Impossible de charger ton rôle.");
        showRole(role);
      })
      .catch((error) => { lobbyStatus.textContent = error.message; });
  }
}

function renderLocalRoleBoard() {
  const board = document.querySelector("#local-role-board");
  const cardScreen = document.querySelector("#deal-card-screen");
  const nextEntry = document.querySelector("#next-player-entry");
  const grid = document.querySelector("#deal-grid");
  const playerCount = activeRoomView.players.length;
  const progressCount = revealedLocalPlayers.size;
  const allNamesEntered = activeRoomView.local_named_indices.length === playerCount;
  const allRolesViewed = progressCount === playerCount;

  cardScreen.hidden = true;
  nextEntry.hidden = true;
  board.hidden = false;
  const startGameButton = document.querySelector("#local-game-start");
  const gameStatus = document.querySelector("#local-game-status");
  startGameButton.hidden = localGameStarted || !allNamesEntered || !allRolesViewed;
  gameStatus.hidden = !localGameStarted;
  grid.replaceChildren();
  document.querySelector("#deal-progress-count").textContent =
    `${progressCount}/${playerCount}`;
  document.querySelector("#deal-progress-fill").style.width =
    `${(progressCount / playerCount) * 100}%`;
  activeRoomView.players.forEach((player, index) => {
    const isNamed = activeRoomView.local_named_indices.includes(index);
    const isRevealed = revealedLocalPlayers.has(index);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "deal-tile";
    tile.style.setProperty("--tile-hue", `${(index * 137.508) % 360}`);
    tile.setAttribute("aria-label", isRevealed
      ? `Revoir le rôle de ${player.name}`
      : isNamed ? `Voir le rôle de ${player.name}` : `Choisir la case ${index + 1}`);
    if (isNamed) {
      const initial = document.createElement("span");
      initial.className = "deal-tile-initial";
      initial.textContent = player.name.charAt(0).toLocaleUpperCase("fr");
      tile.append(initial);
    } else {
      const icon = document.createElement("img");
      icon.className = "deal-tile-icon";
      icon.src = "/resources/cartes/icone.jpeg";
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      tile.append(icon);
    }
    if (isRevealed) tile.classList.add("revealed");
    if (isNamed) {
      const name = document.createElement("span");
      name.className = "deal-tile-name";
      name.textContent = player.name;
      tile.append(name);
    }
    tile.addEventListener("click", () => {
      if (isNamed) {
        openLocalRoleCard(index, isRevealed);
        if (isRevealed) revealLocalRole();
      } else {
        openNextPlayerEntry(index);
      }
    });
    grid.append(tile);
  });

  board.querySelector("h3").textContent =
    progressCount === playerCount ? "TOUS LES RÔLES SONT DÉCOUVERTS" : "CHAQUE JOUEUR";
  board.querySelector("p").textContent = progressCount === playerCount
    ? "La distribution des rôles est terminée."
    : "Choisis une carte pour saisir ton pseudo et découvrir ton rôle";
}

function openNextPlayerEntry(playerIndex) {
  selectedLocalPlayer = playerIndex;
  document.querySelector("#local-role-board").hidden = true;
  document.querySelector("#deal-card-screen").hidden = true;
  const entry = document.querySelector("#next-player-entry");
  entry.hidden = false;
  document.querySelector("#next-player-title").textContent =
    "Saisis ton pseudo pour dévoiler ton rôle";
  const input = document.querySelector("#next-player-name");
  input.value = "";
  input.focus();
}

function openLocalRoleCard(playerIndex, isRevealed = false) {
  selectedLocalPlayer = playerIndex;
  document.querySelector("#deal-status").textContent = "";
  document.querySelector("#next-player-entry").hidden = true;
  document.querySelector("#local-role-board").hidden = true;
  const player = activeRoomView.players[playerIndex];
  const cardButton = document.querySelector("#deal-card-back");
  document.querySelector("#deal-card-flip").classList.remove("is-flipped");
  cardButton.disabled = false;
  document.querySelector("#deal-card-screen").hidden = false;
  document.querySelector("#deal-player-name").textContent = player.name;
  document.querySelector("#deal-card-instruction").textContent =
    isRevealed ? "Touche la carte pour revoir ton rôle" : "Touche la carte pour découvrir ton rôle";
  document.querySelector("#deal-acknowledge").hidden = true;
}

async function revealLocalRole() {
  if (!activeRoom || selectedLocalPlayer === null) return;
  const cardButton = document.querySelector("#deal-card-back");
  const dealStatus = document.querySelector("#deal-status");
  cardButton.disabled = true;
  dealStatus.textContent = "";
  try {
    const response = await fetch(
      `/api/rooms/${encodeURIComponent(activeRoom)}/role?player_index=${selectedLocalPlayer}`,
    );
    const role = await response.json();
    if (!response.ok) throw new Error(role.error || "Impossible de charger le rôle.");
    const roleImage = document.querySelector("#deal-role-image");
    roleImage.src = role.image;
    roleImage.alt = `Carte ${role.name}`;
    await roleImage.decode();
    document.querySelector("#deal-card-flip").classList.add("is-flipped");
    document.querySelector("#deal-card-instruction").textContent = "";
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    document.querySelector("#deal-acknowledge").hidden = false;
  } catch (error) {
    dealStatus.textContent = error.message;
    cardButton.disabled = false;
  }
}

async function refreshRoom() {
  if (!activeRoom) return;
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(activeRoom)}`);
    const room = await response.json();
    if (!response.ok) throw new Error(room.error || "Impossible de retrouver le salon.");
    renderRoom(room);
    if (room.started) {
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      initializeRoleReveal(room);
    }
  } catch (error) {
    lobbyStatus.textContent = error.message;
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }
}

document.querySelector("#create-online-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#host-name").value;
  try {
    setupStatus.textContent = "";
    const room = await postJson("/api/rooms", { mode: "online", name });
    showLobby(room);
  } catch (error) {
    setupStatus.textContent = error.message;
  }
});

document.querySelector("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#join-name").value;
  const code = document.querySelector("#room-code").value;
  try {
    setupStatus.textContent = "";
    const room = await postJson("/api/rooms/join", { name, code });
    showLobby(room);
  } catch (error) {
    setupStatus.textContent = error.message;
  }
});

document.querySelector("#ready-toggle").addEventListener("click", async (event) => {
  if (!activeRoom || !activeRoomView) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const room = await postJson(
      `/api/rooms/${encodeURIComponent(activeRoom)}/ready`,
      { ready: !activeRoomView.viewer_ready },
    );
    renderRoom(room);
  } catch (error) {
    lobbyStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

compositionInputs.forEach((input) => input.addEventListener("change", () => {
  compositionDirty = true;
  compositionStatus.textContent = "Modifications non validées.";
  updateCompositionPreview();
}));

document.querySelector("#save-composition").addEventListener("click", async () => {
  if (!activeRoom) return;
  try {
    const room = await postJson(
      `/api/rooms/${encodeURIComponent(activeRoom)}/composition`,
      selectedComposition(),
    );
    compositionDirty = false;
    compositionStatus.textContent = "";
    renderRoom(room);
  } catch (error) {
    compositionStatus.textContent = error.message;
  }
});

document.querySelector("#start-game").addEventListener("click", async () => {
  if (!activeRoom) return;
  try {
    const room = await postJson(`/api/rooms/${encodeURIComponent(activeRoom)}/start`, {});
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    renderRoom(room);
    initializeRoleReveal(room);
  } catch (error) {
    lobbyStatus.textContent = error.message;
  }
});

document.querySelector("#deal-card-back").addEventListener("click", revealLocalRole);

document.querySelector("#deal-acknowledge").addEventListener("click", () => {
  if (selectedLocalPlayer !== null) revealedLocalPlayers.add(selectedLocalPlayer);
  selectedLocalPlayer = null;
  document.querySelector("#deal-status").textContent = "";
  renderLocalRoleBoard();
});

document.querySelector("#local-game-start").addEventListener("click", () => {
  localGameStarted = true;
  document.querySelector("#local-game-start").hidden = true;
  const status = document.querySelector("#local-game-status");
  status.textContent = "La partie commence ! Les cartes restent disponibles pour revoir les rôles.";
  status.hidden = false;
});

document.querySelector("#next-player-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeRoom || !activeRoomView) return;
  const playerIndex = selectedLocalPlayer;
  if (playerIndex === null) return;
  const input = document.querySelector("#next-player-name");
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  document.querySelector("#deal-status").textContent = "";
  try {
    const room = await postJson(
      `/api/rooms/${encodeURIComponent(activeRoom)}/players/${playerIndex}/name`,
      { name: input.value.trim() },
    );
    activeRoomView = room;
    openLocalRoleCard(playerIndex);
  } catch (error) {
    document.querySelector("#deal-status").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#copy-code").addEventListener("click", async () => {
  const code = document.querySelector("#room-code-display").textContent;
  try {
    await navigator.clipboard.writeText(code);
    lobbyStatus.textContent = "Code copié.";
  } catch {
    lobbyStatus.textContent = `Code du salon : ${code}`;
  }
});

document.querySelector("#back-button").addEventListener("click", async () => {
  if (activeRoomView?.mode === "online" && activeRoom) {
    try {
      await postJson(`/api/rooms/${encodeURIComponent(activeRoom)}/leave`, {});
    } catch (error) {
      lobbyStatus.textContent = error.message;
      return;
    }
  }
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  activeRoom = null;
  activeRoomView = null;
  roomWorkspace.classList.remove("online-room-open");
  lobbyPanel.hidden = true;
  optionsPanel.hidden = false;
  lobbyStatus.textContent = "";
});
