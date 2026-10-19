const minimumPlayers = Number(document.querySelector("main").dataset.minimumPlayers);
const maximumPlayers = Number(document.querySelector("main").dataset.maximumPlayers);
const optionsPanel = document.querySelector("#lobby-options");
const lobbyPanel = document.querySelector("#lobby-view");
const roomWorkspace = document.querySelector("#room-workspace");
const lobbyStatus = document.querySelector("#lobby-status");
const setupStatus = document.querySelector("#setup-status");
const accountPanel = document.querySelector("#account-panel");
const accountToggle = document.querySelector("#account-toggle");
const accountStatus = document.querySelector("#account-status");
const accountAuthForm = document.querySelector("#account-auth-form");
const accountProfileForm = document.querySelector("#account-profile-form");
const accountSignupFields = document.querySelector("#account-signup-fields");
const accountSwitchMode = document.querySelector("#account-switch-mode");
const modeChoices = document.querySelector("#mode-choices");
const modePanels = {
  local: document.querySelector("#local-panel"),
  online: document.querySelector("#online-panel"),
};
const compositionPanel = document.querySelector("#composition-panel");
const compositionStatus = document.querySelector("#composition-status");
const compositionInputs = [...document.querySelectorAll("[data-role]")];
const gamePanel = document.querySelector("#game-panel");
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
let gamePollTimer = null;
let gameTimerInterval = null;
let currentGameTimerId = null;
let currentGameTimer = null;
let currentGameTimerPreviousRemaining = null;
let currentGameAction = null;
let currentGameResponse = null;
let lastGameSpokenMessage = null;
let pendingGameConfirmation = null;
let reminderSpokenForTimer = null;
let gameVoiceEnabled = false;
const gameActionSelections = new Map();
let compositionDirty = false;
let onlineRoleLoaded = false;
let localGameStarted = false;
const revealedLocalPlayers = new Set();
let selectedLocalPlayer = null;
let accountAuthMode = "login";
let currentAccount = null;

const playerCountSelect = document.querySelector("#local-player-count");
const playerFields = document.querySelector("#local-player-fields");
const playerNameEntry = document.querySelector("#player-name-entry");
const playerNameInput = document.querySelector("#player-name-input");
let activePlayerIndex = null;

async function accountRequest(url, method = "GET", data = null) {
  const response = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Le service de comptes a échoué.");
  return result;
}

function showAccount(account) {
  currentAccount = account;
  const signedIn = Boolean(account);
  accountAuthForm.hidden = signedIn;
  accountSwitchMode.hidden = signedIn;
  accountProfileForm.hidden = !signedIn;
  accountToggle.textContent = signedIn ? "Mon profil" : "Mon compte";
  if (!signedIn) return;

  document.querySelector("#account-profile-email").textContent = account.email;
  document.querySelector("#account-profile-name").value = account.profile.display_name;
  document.querySelector("#account-profile-bio").value = account.profile.bio || "";
  for (const input of ["#host-name", "#join-name"]) {
    const nameInput = document.querySelector(input);
    if (!nameInput.value) nameInput.value = account.profile.display_name;
  }
}

async function loadAccount() {
  accountStatus.textContent = "";
  try {
    const result = await accountRequest("/api/account/profile");
    showAccount(result.account);
  } catch (error) {
    showAccount(null);
    if (!error.message.includes("Connecte-toi") && !error.message.includes("session a expiré")) {
      accountStatus.textContent = error.message;
    }
  }
}

accountToggle.addEventListener("click", async () => {
  accountPanel.hidden = !accountPanel.hidden;
  if (!accountPanel.hidden) await loadAccount();
});

const gameVoiceToggle = document.querySelector("#game-voice-toggle");
gameVoiceToggle.addEventListener("click", () => {
  if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
    document.querySelector("#game-countdown").textContent =
      "La synthèse vocale n’est pas disponible dans ce navigateur.";
    return;
  }
  gameVoiceEnabled = !gameVoiceEnabled;
  gameVoiceToggle.setAttribute("aria-pressed", String(gameVoiceEnabled));
  gameVoiceToggle.textContent = gameVoiceEnabled
    ? "Désactiver la voix du maître du jeu"
    : "Activer la voix du maître du jeu";
  if (gameVoiceEnabled && currentGameResponse) {
    speakGameMaster(currentGameAction?.prompt || currentGameResponse.state.message);
  } else {
    window.speechSynthesis.cancel();
  }
});

document.querySelector("#account-close").addEventListener("click", () => {
  accountPanel.hidden = true;
});

accountSwitchMode.addEventListener("click", () => {
  accountAuthMode = accountAuthMode === "login" ? "signup" : "login";
  const signingUp = accountAuthMode === "signup";
  accountSignupFields.hidden = !signingUp;
  document.querySelector("#account-auth-submit").innerHTML = signingUp
    ? "Créer mon compte <span>↗</span>"
    : "Se connecter <span>↗</span>";
  accountSwitchMode.textContent = signingUp
    ? "J’ai déjà un compte"
    : "Créer un compte";
  document.querySelector("#account-password").autocomplete =
    signingUp ? "new-password" : "current-password";
  accountStatus.textContent = "";
});

accountAuthForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#account-auth-submit");
  submit.disabled = true;
  accountStatus.textContent = "";
  const data = {
    email: document.querySelector("#account-email").value,
    password: document.querySelector("#account-password").value,
  };
  try {
    if (accountAuthMode === "signup") {
      data.display_name = document.querySelector("#account-display-name").value;
      const result = await accountRequest("/api/account/signup", "POST", data);
      if (result.requires_confirmation) {
        accountAuthMode = "login";
        accountSignupFields.hidden = true;
        accountSwitchMode.textContent = "Créer un compte";
        submit.innerHTML = "Se connecter <span>↗</span>";
        accountStatus.textContent = result.message;
        return;
      }
      showAccount(result.account);
      accountStatus.textContent = "Ton compte est créé et ton profil est prêt.";
    } else {
      const result = await accountRequest("/api/account/login", "POST", data);
      showAccount(result.account);
      accountStatus.textContent = "Tu es connecté.";
    }
  } catch (error) {
    accountStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

accountProfileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = accountProfileForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  accountStatus.textContent = "";
  try {
    const result = await accountRequest("/api/account/profile", "PATCH", {
      display_name: document.querySelector("#account-profile-name").value,
      bio: document.querySelector("#account-profile-bio").value,
    });
    showAccount(result.account);
    accountStatus.textContent = "Ton profil a été enregistré.";
  } catch (error) {
    accountStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#account-logout").addEventListener("click", async () => {
  try {
    await accountRequest("/api/account/logout", "POST", {});
    showAccount(null);
    accountStatus.textContent = "Tu es déconnecté.";
  } catch (error) {
    accountStatus.textContent = error.message;
  }
});

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
    updatedRoom.local_role_viewed_indices.forEach((index) => revealedLocalPlayers.add(index));
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
  if (gamePollTimer) window.clearInterval(gamePollTimer);
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
    document.querySelector("#local-role-flow").hidden = room.game?.phase !== "dealing";
    gamePanel.hidden = room.game?.phase === "dealing";
    if (room.game?.phase !== "dealing" && localGameStarted) {
      refreshGamePanel();
      return;
    }
    renderLocalRoleBoard();
    return;
  }
  document.querySelector("#online-role-flow").hidden = false;
  document.querySelector("#local-role-flow").hidden = true;
  gamePanel.hidden = false;
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
  refreshGamePanel();
  if (gamePollTimer) window.clearInterval(gamePollTimer);
  gamePollTimer = window.setInterval(refreshGamePanel, 2000);
  if (gameTimerInterval) window.clearInterval(gameTimerInterval);
  gameTimerInterval = window.setInterval(updateGameCountdown, 250);
}

function gamePhaseLabel(phase) {
  return {
    dealing: "Distribution des rôles",
    night: "La nuit tombe",
    day: "Le village se réveille",
    hunter: "Dernier tir du Chasseur",
    finished: "Partie terminée",
  }[phase] || "Partie en cours";
}

function speakGameMaster(text) {
  if (!gameVoiceEnabled || !text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = 0.94;
  const frenchVoice = window.speechSynthesis.getVoices().find(
    (voice) => voice.lang.toLowerCase().startsWith("fr"),
  );
  if (frenchVoice) utterance.voice = frenchVoice;
  window.speechSynthesis.speak(utterance);
}

function formatCountdown(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updateGameCountdown() {
  const countdown = document.querySelector("#game-countdown");
  if (!currentGameTimer) {
    countdown.hidden = true;
    return;
  }
  countdown.hidden = false;
  const remaining = Math.max(
    0,
    Math.ceil(currentGameTimer.deadline - Date.now() / 1000),
  );
  countdown.textContent = remaining
    ? `Temps restant : ${formatCountdown(remaining)}`
    : "Temps écoulé — résolution en cours";
  const halfway = currentGameTimer.duration / 2;
  if (
    currentGameAction
    && currentGameTimerPreviousRemaining !== null
    && currentGameTimerPreviousRemaining > halfway
    && remaining <= halfway
    && reminderSpokenForTimer !== currentGameTimer.id
  ) {
    reminderSpokenForTimer = currentGameTimer.id;
    speakGameMaster(currentGameAction.prompt);
  }
  currentGameTimerPreviousRemaining = remaining;
}

function actionVerb(action, fieldName) {
  if (fieldName === "first_target" || fieldName === "second_target") return "lier";
  if (fieldName === "kill_target") return "empoisonner";
  return {
    vote: "bannir",
    wolf_vote: "dévorer",
    enrage: "infecter",
    white_wolf: "éliminer",
    seer: "sonder",
    hunter: "éliminer",
  }[action.kind] || "choisir";
}

function renderPlayerChoiceField(form, field, action) {
  const label = document.createElement("label");
  label.textContent = field.label;
  const select = document.createElement("select");
  select.className = "game-player-select";
  select.name = field.name;
  select.setAttribute("aria-label", field.label);
  select.dataset.required = String(field.required);
  field.options.forEach((option) => {
    const choice = document.createElement("option");
    choice.value = option.value;
    choice.textContent = option.label;
    select.append(choice);
  });
  select.value = gameActionSelections.get(field.name) || "";
  label.append(select);
  form.append(label);

  const choices = document.createElement("div");
  choices.className = "game-player-choices";
  choices.setAttribute("aria-label", field.label);
  const otherCupidTarget = field.name === "second_target"
    ? gameActionSelections.get("first_target")
    : field.name === "first_target"
      ? gameActionSelections.get("second_target")
      : null;
  field.options.filter((option) => option.value).forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-player-choice";
    button.dataset.gameChoice = field.name;
    button.dataset.playerIndex = option.value;
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(select.value === option.value));
    button.disabled = option.value === otherCupidTarget;
    choices.append(button);
  });
  form.append(choices);

  if (select.value) {
    const selectedName = field.options.find(
      (option) => option.value === select.value,
    )?.label;
    const deselect = document.createElement("button");
    deselect.type = "button";
    deselect.className = "game-player-deselect";
    deselect.dataset.gameDeselect = field.name;
    deselect.textContent = `Désélectionner ${selectedName || "ce joueur"}`;
    form.append(deselect);
  }

  if (field.options.some((option) => option.value === "")) {
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "game-player-skip";
    skip.dataset.gameSkip = field.name;
    skip.textContent = field.name === "target"
      ? "M’abstenir"
      : "Ne pas utiliser ce pouvoir";
    form.append(skip);
  }

  const confirmation = document.createElement("div");
  confirmation.className = "game-confirmation";
  confirmation.hidden = pendingGameConfirmation?.field !== field.name;
  if (!confirmation.hidden) {
    const player = field.options.find(
      (option) => option.value === pendingGameConfirmation.playerIndex,
    );
    const question = document.createElement("p");
    question.textContent = `Voulez-vous ${actionVerb(action, field.name)} ${player?.label || "ce joueur"} ?`;
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "primary-button";
    confirm.dataset.gameConfirm = field.name;
    confirm.textContent = "Confirmer";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "back-button";
    cancel.dataset.gameCancel = field.name;
    cancel.textContent = "Annuler";
    confirmation.append(question, confirm, cancel);
  }
  form.append(confirmation);
}

function renderGamePanel(response) {
  currentGameResponse = response;
  const state = response.state;
  const timer = state.timer;
  const timerChanged = timer?.id !== currentGameTimerId;
  if (timerChanged) {
    gameActionSelections.clear();
    pendingGameConfirmation = null;
    currentGameTimerId = timer?.id || null;
    reminderSpokenForTimer = null;
    currentGameTimerPreviousRemaining = timer
      ? Math.max(0, Math.ceil(timer.deadline - Date.now() / 1000))
      : null;
  }
  currentGameTimer = timer;
  currentGameAction = response.action;
  if (timerChanged) {
    speakGameMaster(response.action?.prompt || state.message);
    if (!response.action) lastGameSpokenMessage = state.message;
  } else if (
    !response.action
    && state.message !== lastGameSpokenMessage
  ) {
    lastGameSpokenMessage = state.message;
    speakGameMaster(state.message);
  } else if (response.action && reminderSpokenForTimer === timer?.id) {
    currentGameAction = response.action;
  }
  document.querySelector("#game-round").textContent =
    state.phase === "day" ? `JOUR ${state.round}` : `NUIT ${state.round}`;
  document.querySelector("#game-phase-title").textContent = gamePhaseLabel(state.phase);
  document.querySelector("#game-message").textContent = state.message;
  document.querySelector("#game-progress").textContent =
    state.phase === "day"
      ? `Votes reçus : ${state.votes_received}/${state.vote_total}`
      : state.current_actor ? `Action en cours : ${state.current_actor}` : "";
  const deaths = document.querySelector("#game-deaths");
  deaths.replaceChildren();
  if (state.deaths.length) {
    const heading = document.createElement("strong");
    heading.textContent = "Joueurs éliminés";
    const list = document.createElement("ul");
    state.deaths.forEach((death) => {
      const item = document.createElement("li");
      item.textContent = `${death.name} — ${death.cause}`;
      list.append(item);
    });
    deaths.append(heading, list);
  }

  const area = document.querySelector("#game-action-area");
  area.replaceChildren();
  const action = response.action;
  if (action) {
    const prompt = document.createElement("p");
    prompt.className = "game-action-prompt";
    const speaker = document.createElement("span");
    speaker.className = "game-master-speaker";
    speaker.textContent = "Maître du jeu";
    const dialogue = document.createElement("span");
    dialogue.textContent = action.prompt;
    prompt.append(speaker, dialogue);
    const form = document.createElement("form");
    form.id = "game-action-form";
    action.fields.forEach((field) => {
      if (
        ["target", "first_target", "second_target", "kill_target"].includes(field.name)
        && field.options.some((option) => option.value)
      ) {
        renderPlayerChoiceField(form, field, action);
      } else {
        const label = document.createElement("label");
        label.textContent = field.label;
        const select = document.createElement("select");
        select.name = field.name;
        select.required = field.required;
        field.options.forEach((option) => {
          const choice = document.createElement("option");
          choice.value = option.value;
          choice.textContent = option.label;
          select.append(choice);
        });
        label.append(select);
        form.append(label);
      }
    });
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary-button";
    submit.textContent = action.button;
    submit.disabled = [...form.querySelectorAll("select")].some((select) => (
      (select.required || select.dataset.required === "true") && !select.value
    ));
    form.append(submit);
    const status = document.createElement("p");
    status.className = "game-action-status";
    status.id = "game-action-status";
    form.append(status);
    area.append(prompt, form);
  } else if (state.phase === "finished") {
    const winners = document.createElement("p");
    const names = {
      village: "Village",
      meute: "Meute",
      loup_blanc: "Loup Blanc",
      amoureux: "Amoureux",
    };
    winners.className = "game-winners";
    winners.textContent = state.winners.map((winner) => names[winner] || winner).join(" · ");
    area.append(winners);
  } else {
    const waiting = document.createElement("p");
    waiting.textContent = state.phase === "day"
      ? "Tous les votes sont enregistrés."
      : state.current_actor
        ? `En attente de ${state.current_actor}…`
        : "En attente de la prochaine étape…";
    area.append(waiting);
  }
  if (response.private_result) {
    const privateResult = document.createElement("p");
    privateResult.className = "private-game-result";
    privateResult.textContent = response.private_result;
    area.append(privateResult);
  }
  updateGameCountdown();
}

async function refreshGamePanel() {
  if (!activeRoom || !activeRoomView?.started || !activeRoomView.game) return;
  try {
    let playerIndex = null;
    let url = `/api/rooms/${encodeURIComponent(activeRoom)}/game`;
    if (activeRoomView.mode === "local") {
      const state = activeRoomView.game;
      if (state.phase === "day") {
        playerIndex = state.alive_indices.find((index) => !state.voted_indices.includes(index));
      } else if (state.current_actor) {
        playerIndex = activeRoomView.players.findIndex(
          (player) => player.name === state.current_actor,
        );
      }
      if (playerIndex === undefined || playerIndex < 0) return;
      if (playerIndex === null) {
        renderGamePanel({ state, action: null });
        return;
      }
      url += `?player_index=${playerIndex}`;
    }
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Impossible de charger la partie.");
    renderGamePanel(result);
  } catch (error) {
    lobbyStatus.textContent = error.message;
  }
}

document.querySelector("#game-action-area").addEventListener("submit", async (event) => {
  if (event.target.id !== "game-action-form" || !activeRoom) return;
  event.preventDefault();
  const incomplete = [...event.target.querySelectorAll("select")].some((select) => (
    (select.required || select.dataset.required === "true") && !select.value
  ));
  if (incomplete) {
    document.querySelector("#game-action-status").textContent =
      "Choisis et confirme chaque joueur demandé avant de valider.";
    return;
  }
  const payload = {};
  for (const [key, value] of new FormData(event.target).entries()) {
    payload[key] = key === "save"
      ? value
      : value === "" ? null : Number(value);
  }
  let playerIndex = null;
  if (activeRoomView.mode === "local") {
    const phase = activeRoomView.game.phase;
    playerIndex = phase === "day"
      ? activeRoomView.game.alive_indices.find(
        (index) => !activeRoomView.game.voted_indices.includes(index),
      )
      : activeRoomView.players.findIndex(
        (player) => player.name === activeRoomView.game.current_actor,
      );
    payload.player_index = playerIndex;
  }
  const submit = event.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await postJson(`/api/rooms/${encodeURIComponent(activeRoom)}/game/action`, payload);
    if (activeRoomView.mode === "local") {
      const response = await fetch(`/api/rooms/${encodeURIComponent(activeRoom)}`);
      const room = await response.json();
      if (!response.ok) throw new Error(room.error || "Impossible de retrouver la partie.");
      activeRoomView = room;
    }
    await refreshGamePanel();
  } catch (error) {
    lobbyStatus.textContent = error.message;
    submit.disabled = false;
  }
});

document.querySelector("#game-action-area").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !currentGameResponse) return;
  if (button.dataset.gameChoice) {
    pendingGameConfirmation = {
      field: button.dataset.gameChoice,
      playerIndex: button.dataset.playerIndex,
    };
    renderGamePanel(currentGameResponse);
    return;
  }
  if (button.dataset.gameConfirm) {
    gameActionSelections.set(
      button.dataset.gameConfirm,
      pendingGameConfirmation.playerIndex,
    );
    pendingGameConfirmation = null;
    renderGamePanel(currentGameResponse);
    return;
  }
  if (button.dataset.gameCancel) {
    pendingGameConfirmation = null;
    renderGamePanel(currentGameResponse);
    return;
  }
  if (button.dataset.gameDeselect || button.dataset.gameSkip) {
    gameActionSelections.delete(button.dataset.gameDeselect || button.dataset.gameSkip);
    if (pendingGameConfirmation) pendingGameConfirmation = null;
    renderGamePanel(currentGameResponse);
  }
});

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
      const name = document.createElement("span");
      name.className = "deal-tile-name";
      name.textContent = player.name;
      tile.append(name);
    } else {
      const icon = document.createElement("img");
      icon.className = "deal-tile-icon";
      icon.src = "/resources/cartes/icone.jpeg";
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      tile.append(icon);
    }
    if (isRevealed) tile.classList.add("revealed");
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

document.querySelector("#local-game-start").addEventListener("click", async () => {
  if (!activeRoom) return;
  const button = document.querySelector("#local-game-start");
  button.disabled = true;
  try {
    const room = await postJson(
      `/api/rooms/${encodeURIComponent(activeRoom)}/game/begin`,
      {},
    );
    localGameStarted = true;
    activeRoomView = room;
    renderRoom(room);
    initializeRoleReveal(room);
  } catch (error) {
    document.querySelector("#local-game-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
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
  if (gamePollTimer) {
    window.clearInterval(gamePollTimer);
    gamePollTimer = null;
  }
  activeRoom = null;
  activeRoomView = null;
  roomWorkspace.classList.remove("online-room-open");
  lobbyPanel.hidden = true;
  optionsPanel.hidden = false;
  lobbyStatus.textContent = "";
});
