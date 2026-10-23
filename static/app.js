const minimumPlayers = Number(document.querySelector("main").dataset.minimumPlayers);
const maximumPlayers = Number(document.querySelector("main").dataset.maximumPlayers);
const optionsPanel = document.querySelector("#lobby-options");
const lobbyPanel = document.querySelector("#lobby-view");
const roomWorkspace = document.querySelector("#room-workspace");
const lobbyStatus = document.querySelector("#lobby-status");
const setupStatus = document.querySelector("#setup-status");
const accountPanel = document.querySelector("#account-panel");
const accountToggle = document.querySelector("#account-toggle");
const introScene = document.querySelector("#intro-scene");
const introAudio = document.querySelector("#game-intro-audio");
const introAudioToggle = document.querySelector("#intro-audio-toggle");
const introAudioLabel = document.querySelector("#intro-audio-label");
const introEnter = document.querySelector("#intro-enter");
const introEnterLabel = document.querySelector("#intro-enter-label");
const introStatus = document.querySelector("#intro-status");
const introHowPanel = document.querySelector("#intro-how-panel");
const introHowButton = document.querySelector("#intro-how-button");
const introAction = document.querySelector("#intro-skip");
const introActionIcon = document.querySelector("#intro-skip-icon");
const introActionLabel = document.querySelector("#intro-skip-label");
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
const gameExitHint = document.querySelector("#game-exit-hint");
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
let currentGameActionKey = null;
let currentGameResponse = null;
let lastGameSpokenMessage = null;
let currentInstructionKey = null;
let acknowledgedInstructionKey = null;
let instructionSpeechFallback = null;
let currentGameAudioCueId = 0;
let gameAudioFallbackTimer = null;
let pendingGameConfirmation = null;
let reminderSpokenForTimer = null;
let gameVoiceEnabled = true;
const gameActionSelections = new Map();
const seenPrivateGameResults = new Set();
const seenWitchVictimResults = new Set();
let pendingPrivateGameResult = null;
let privateGameResultRevealed = false;
let allowPrivateLoversResult = false;
let privatePairRopeObserver = null;
let pendingWitchVictimResultKey = null;
let witchVictimResultRevealed = false;
let compositionDirty = false;
let onlineRoleLoaded = false;
let localGameStarted = false;
let chiefDrawTimer = null;
let chiefDrawShown = false;
let chiefDrawAcknowledged = false;
let chiefInstructionsAcknowledged = false;
const revealedLocalPlayers = new Set();
let selectedLocalPlayer = null;
let accountAuthMode = "login";
let currentAccount = null;
let gameBackHistoryActive = false;
let gameBackPressArmed = false;
let gameBackPressTimer = null;

const introStorageKey = "wolfie-intro-seen";
const activeRoomStorageKey = "wolfie-active-room";
const gameUiStorageKey = "wolfie-game-ui";
let firstVisitIntro = false;

function readStoredJson(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeStoredJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The game remains playable when browser storage is unavailable.
  }
}

function persistGameSession() {
  if (!activeRoom || !activeRoomView) return;
  writeStoredJson(activeRoomStorageKey, {
    code: activeRoom,
    mode: activeRoomView.mode,
  });
  writeStoredJson(gameUiStorageKey, {
    privateGameResultRevealed,
    witchVictimResultRevealed,
    acknowledgedInstructionKey,
    chiefDrawShown,
    chiefDrawAcknowledged,
    chiefInstructionsAcknowledged,
    localGameStarted,
    selectedLocalPlayer,
    revealedLocalPlayers: [...revealedLocalPlayers],
  });
}

function clearPersistedGameSession() {
  try {
    window.localStorage.removeItem(activeRoomStorageKey);
    window.localStorage.removeItem(gameUiStorageKey);
  } catch {
    // Nothing to clear when browser storage is unavailable.
  }
}

try {
  firstVisitIntro = window.localStorage.getItem(introStorageKey) !== "true"
    || new URLSearchParams(window.location.search).get("intro") === "1";
} catch {
  firstVisitIntro = true;
}

function enterHome() {
  if (introScene.hidden) return;
  try {
    window.localStorage.setItem(introStorageKey, "true");
  } catch {
    // The intro still works when browser storage is unavailable.
  }
  introScene.classList.add("is-leaving");
  introAudio.pause();
  introScene.setAttribute("aria-hidden", "true");
  document.querySelector("header").inert = false;
  document.querySelector("main").inert = false;
  document.querySelector("footer").inert = false;
  document.documentElement.classList.remove("intro-active");
  document.body.classList.remove("intro-active");
  applyStartMode();
  window.setTimeout(() => {
    introScene.hidden = true;
    introScene.classList.remove("is-leaving");
  }, 800);
}

function skipIntro() {
  enterHome();
}

async function startIntroAudio() {
  if (introAudio.ended) introAudio.currentTime = 0;
  try {
    await introAudio.play();
  } catch {
    introStatus.textContent =
      "Le navigateur bloque le son automatique. Lance l’introduction pour commencer.";
  }
}

function updateIntroAudioControl(playing) {
  const label = playing ? "Introduction en cours" : "Écouter l’introduction";
  introAudioToggle.setAttribute("aria-pressed", String(playing));
  introAudioToggle.setAttribute("aria-label", label);
  introAudioLabel.textContent = label;
  introAudioToggle.classList.toggle("is-playing", playing);
  introScene.classList.toggle("is-playing", playing);
  if (playing) {
    introEnterLabel.textContent = "L’introduction se déroule…";
    introEnter.disabled = true;
    introStatus.textContent = "Laisse l’histoire se dérouler jusqu’au bout.";
  }
}

introAudio.addEventListener("play", () => updateIntroAudioControl(true));
introAudio.addEventListener("pause", () => {
  updateIntroAudioControl(false);
  if (!introScene.hidden && !introScene.classList.contains("is-leaving") && !introAudio.ended && introEnter.disabled) {
    introStatus.textContent = "L’introduction reprend…";
    window.setTimeout(() => {
      if (!introScene.hidden && introAudio.paused && !introAudio.ended) {
        startIntroAudio();
      }
    }, 150);
  }
});
introAudio.addEventListener("ended", () => {
  updateIntroAudioControl(false);
  if (introScene.hidden) return;
  introActionIcon.textContent = "✦";
  introActionLabel.textContent = "Commencer la partie";
  introAction.setAttribute("aria-label", "Commencer la partie");
  introStatus.hidden = true;
  introHowPanel.hidden = true;
  introScene.setAttribute("aria-labelledby", "intro-title");
  introScene.removeAttribute("aria-describedby");
  introAction.focus();
});
introAudioToggle.addEventListener("click", async () => {
  if (introScene.hidden) window.location.assign("/?intro=1");
});

introEnter.addEventListener("click", async () => {
  if (!introEnter.disabled && introAudio.paused) await startIntroAudio();
});
introAction.addEventListener("click", () => {
  if (!introAudio.ended) {
    skipIntro();
    return;
  }
  try {
    window.localStorage.setItem(introStorageKey, "true");
  } catch {
    // The mode selection still works when browser storage is unavailable.
  }
  window.location.assign("/");
});
introHowButton.addEventListener("click", () => {
  introContentHidden(true);
  introHowButton.hidden = true;
  introHowPanel.hidden = false;
  introScene.setAttribute("aria-labelledby", "intro-how-title");
  document.querySelector("#intro-how-back").focus();
});
document.querySelector("#intro-how-back").addEventListener("click", () => {
  introHowPanel.hidden = true;
  introHowButton.hidden = false;
  introContentHidden(false);
  introScene.setAttribute("aria-labelledby", "intro-title");
  document.querySelector("#intro-how-button").focus();
});

function introContentHidden(hidden) {
  for (const element of [
    document.querySelector(".intro-kicker"),
    document.querySelector(".intro-emblem"),
    document.querySelector(".intro-wordmark"),
    document.querySelector("#intro-title"),
    document.querySelector(".intro-tagline"),
    introAction,
  ]) {
    element.hidden = hidden;
  }
}

introAudio.volume = 0.78;
if (firstVisitIntro) {
  document.documentElement.classList.add("intro-active");
  document.body.classList.add("intro-active");
  document.querySelector("header").inert = true;
  document.querySelector("main").inert = true;
  document.querySelector("footer").inert = true;
  introAction.focus();
  startIntroAudio();
} else {
  introScene.hidden = true;
  introScene.setAttribute("aria-hidden", "true");
}

const playerCountSelect = document.querySelector("#local-player-count");
const playerCountDisplay = document.querySelector("#player-count-display");
const playerCountPicker = document.querySelector("#player-count-picker");
const localPlayerSetup = document.querySelector("#local-player-setup");
const playerFields = document.querySelector("#local-player-fields");
const playerNameEntry = document.querySelector("#player-name-entry");
const playerNameInput = document.querySelector("#player-name-input");
const localRoleSetup = document.querySelector("#local-role-setup");
const localRoleCards = document.querySelector("#local-role-cards");
const localRoleSummary = document.querySelector("#local-role-summary");
const localRoleContinue = document.querySelector("#local-role-continue");
const localRoleReference = document.querySelector("#local-role-reference");
const localRoleReferenceList = document.querySelector("#local-role-reference-list");
const localRoleCounts = Object.fromEntries([
  "voyante", "sorciere", "cupidon", "chasseur", "loup_garou",
  "loup_enrage", "loup_blanc", "villageois",
].map((role) => [role, 0]));
let localRoleSetupPlayerCount = null;
const localRoleCardsData = [
  { id: "villageois", name: "Villageois", image: "Villageois.jpeg", unique: false, description: "Sans pouvoir spécial, tu aides le village à démasquer les loups." },
  { id: "loup_garou", name: "Loup-Garou", image: "Loup garou.jpeg", unique: false, description: "Chaque nuit, vote avec la meute pour éliminer un joueur." },
  { id: "voyante", name: "Voyante", image: "Voyante.jpeg", unique: true, description: "Chaque nuit, découvre le rôle d’un joueur." },
  { id: "sorciere", name: "Sorcière", image: "Sorcière.jpeg", unique: true, description: "Tu possèdes une potion de vie et une potion de mort, chacune utilisable une fois." },
  { id: "chasseur", name: "Chasseur", image: "Chasseur.png", unique: true, description: "À ta mort, tu peux éliminer un joueur vivant." },
  { id: "cupidon", name: "Cupidon", image: "Cupidon.png", unique: true, description: "La première nuit, lie deux joueurs : si l’un meurt, l’autre meurt aussi." },
  { id: "loup_enrage", name: "Loup Enragé", image: "Loup enragé.jpeg", unique: true, description: "Une fois dans la partie, convertis un joueur en Loup-Garou ordinaire." },
  { id: "loup_blanc", name: "Loup Blanc", image: "Loup blanc.jpeg", unique: true, description: "Indépendant, tu peux éliminer un joueur une nuit sur deux à partir de la nuit 2." },
];
let activePlayerIndex = null;

function selectedLocalRoleCount() {
  return Object.values(localRoleCounts).reduce((total, count) => total + count, 0);
}

function initializeLocalRoleCounts(playerCount) {
  if (localRoleSetupPlayerCount === playerCount) return;
  for (const role of Object.keys(localRoleCounts)) localRoleCounts[role] = 0;

  const specialRoles = ["voyante", "sorciere"];
  if (playerCount >= 9) specialRoles.push("cupidon");
  if (playerCount >= 12) specialRoles.push("chasseur");
  const wolfVariants = [];
  if (playerCount >= 9) wolfVariants.push("loup_enrage");
  if (playerCount >= 12) wolfVariants.push("loup_blanc");

  specialRoles.forEach((role) => { localRoleCounts[role] = 1; });
  wolfVariants.forEach((role) => { localRoleCounts[role] = 1; });
  const wolfCount = Math.floor((playerCount - specialRoles.length) / 2);
  localRoleCounts.loup_garou = wolfCount - wolfVariants.length;
  localRoleCounts.villageois = playerCount - specialRoles.length - wolfCount;
  localRoleSetupPlayerCount = playerCount;
}

function renderLocalRoleCards() {
  const playerCount = Number(playerCountSelect.value);
  const selectedCount = selectedLocalRoleCount();
  const remainingCount = playerCount - selectedCount;
  localRoleSummary.textContent = `${selectedCount} / ${playerCount} rôles choisis`;
  localRoleContinue.disabled = remainingCount !== 0;
  localRoleContinue.textContent = remainingCount === 0
    ? `Jouer avec ces ${selectedCount} rôles`
    : `Choisir encore ${remainingCount} rôle${remainingCount > 1 ? "s" : ""}`;
  localRoleCards.replaceChildren();

  for (const role of localRoleCardsData) {
    const count = localRoleCounts[role.id];
    const card = document.createElement("article");
    card.className = "local-role-card";
    card.classList.toggle("is-selected", count > 0);

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "local-role-art";
    selectButton.setAttribute("aria-pressed", String(count > 0));
    selectButton.setAttribute("aria-label", count > 0
      ? `Retirer toutes les cartes ${role.name}`
      : `Ajouter une carte ${role.name}`);
    const image = document.createElement("img");
    image.src = `/resources/cartes mini/sans contour/${encodeURIComponent(role.image)}`;
    image.alt = role.name;
    image.loading = "lazy";
    const roleName = document.createElement("span");
    roleName.className = "local-role-name";
    roleName.textContent = role.name;
    selectButton.append(image, roleName);
    selectButton.addEventListener("click", () => {
      if (count > 0) {
        localRoleCounts[role.id] = 0;
      } else if (selectedLocalRoleCount() < playerCount) {
        localRoleCounts[role.id] = 1;
      } else {
        localRoleSummary.textContent = `Retire une carte avant d’en ajouter une autre (${playerCount} maximum).`;
        return;
      }
      renderLocalRoleCards();
    });

    const countBadge = document.createElement("span");
    countBadge.className = "local-role-quantity";
    countBadge.hidden = count === 0;
    countBadge.textContent = `×${count}`;
    countBadge.setAttribute("aria-label", `${count} carte${count > 1 ? "s" : ""}`);

    const controls = document.createElement("div");
    controls.className = "local-role-controls";
    controls.hidden = count === 0;
    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.className = "local-role-step";
    decrease.textContent = "−";
    decrease.setAttribute("aria-label", `Retirer une carte ${role.name}`);
    decrease.addEventListener("click", () => {
      localRoleCounts[role.id] = Math.max(0, localRoleCounts[role.id] - 1);
      renderLocalRoleCards();
    });
    const increase = document.createElement("button");
    increase.type = "button";
    increase.className = "local-role-step";
    increase.textContent = "+";
    increase.setAttribute("aria-label", `Ajouter une carte ${role.name}`);
    increase.disabled = (role.unique && count >= 1)
      || selectedLocalRoleCount() >= playerCount;
    increase.addEventListener("click", () => {
      if (increase.disabled) return;
      localRoleCounts[role.id] += 1;
      renderLocalRoleCards();
    });
    controls.append(decrease, countBadge, increase);
    card.append(selectButton, controls);
    localRoleCards.append(card);
  }
}

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
  document.querySelector("#local-player-total").textContent = `${count} JOUEURS`;
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
    tile.style.setProperty("--tile-hue", `${(index * 137.508) % 360}`);
    tile.setAttribute("aria-label", previousNames[index]
      ? `Pseudo saisi : ${previousNames[index]}`
      : `Saisir le pseudo du joueur ${index + 1}`);
    if (previousNames[index]) {
      tile.classList.add("player-card-complete");
      const initial = document.createElement("span");
      initial.className = "player-card-initial";
      initial.textContent = previousNames[index].charAt(0).toLocaleUpperCase("fr");
      const playerNumber = document.createElement("span");
      playerNumber.className = "player-card-number";
      playerNumber.textContent = `#${String(index + 1).padStart(2, "0")}`;
      const playerName = document.createElement("span");
      playerName.className = "player-card-name";
      playerName.textContent = previousNames[index];
      tile.append(initial, playerNumber, playerName);
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

function renderLocalRoleReference() {
  localRoleReferenceList.replaceChildren();
  for (const role of localRoleCardsData) {
    const entry = document.createElement("article");
    entry.className = "role-reference-entry";
    const title = document.createElement("h3");
    title.textContent = role.name;
    const description = document.createElement("p");
    description.textContent = role.description;
    entry.append(title, description);
    localRoleReferenceList.append(entry);
  }
}

function updatePlayerCountPicker() {
  const count = Number(playerCountSelect.value);
  playerCountDisplay.textContent = String(count);
  playerCountDisplay.setAttribute("aria-label", `${count} joueurs`);
  document.querySelector('[data-count-step="-1"]').disabled = count <= minimumPlayers;
  document.querySelector('[data-count-step="1"]').disabled = count >= maximumPlayers;
}

function showPlayerCountPicker() {
  document.body.classList.remove("role-setup-active", "player-setup-active");
  document.body.classList.add("player-count-active");
  playerCountPicker.hidden = false;
  localRoleSetup.hidden = true;
  localPlayerSetup.hidden = true;
}

document.querySelectorAll("[data-count-step]").forEach((button) => {
  button.addEventListener("click", () => {
    const step = Number(button.dataset.countStep);
    const count = Number(playerCountSelect.value);
    playerCountSelect.value = String(Math.max(
      minimumPlayers,
      Math.min(maximumPlayers, count + step),
    ));
    updatePlayerCountPicker();
  });
});

document.querySelector("#player-count-continue").addEventListener("click", () => {
  document.body.classList.remove("player-count-active");
  playerCountPicker.hidden = true;
  initializeLocalRoleCounts(Number(playerCountSelect.value));
  renderLocalRoleCards();
  localRoleSetup.hidden = false;
  document.body.classList.add("role-setup-active");
  localRoleContinue.focus();
});

document.querySelector("#player-count-back").addEventListener("click", () => {
  window.location.assign("/");
});

document.querySelector("#edit-local-player-count").addEventListener("click", () => {
  document.body.classList.remove("role-setup-active");
  showPlayerCountPicker();
  document.querySelector('[data-count-step="-1"]').focus();
});

localRoleContinue.addEventListener("click", () => {
  if (localRoleContinue.disabled) return;
  renderLocalPlayerFields();
  localRoleSetup.hidden = true;
  document.body.classList.remove("role-setup-active");
  localPlayerSetup.hidden = false;
  document.body.classList.add("player-setup-active");
  playerFields.querySelector("button")?.focus();
});

document.querySelector("#edit-local-roles").addEventListener("click", () => {
  document.body.classList.remove("player-setup-active");
  localPlayerSetup.hidden = true;
  renderLocalRoleCards();
  localRoleSetup.hidden = false;
  document.body.classList.add("role-setup-active");
  localRoleContinue.focus();
});

document.querySelector("#local-role-consult").addEventListener("click", () => {
  renderLocalRoleReference();
  localRoleReference.showModal();
});
document.querySelector("#local-role-reference-close").addEventListener("click", () => {
  localRoleReference.close();
});

function openPlayerNameEntry(index) {
  const tile = playerFields.querySelector(`[data-player-index="${index}"]`);
  if (tile.dataset.playerName) return;
  activePlayerIndex = index;
  playerNameInput.value = tile.dataset.playerName;
  document.querySelector("#player-name-title").textContent =
    `Joueur ${String(index + 1).padStart(2, "0")}, saisis ton pseudo`;
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
      await postJson(
        `/api/rooms/${encodeURIComponent(createdRoom.code)}/composition`,
        { role_counts: { ...localRoleCounts } },
      );
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
    playerFields.querySelector(`[data-player-index="${playerIndex}"]`).dataset.playerName =
      updatedRoom.players[playerIndex].name;
    renderLocalPlayerFields();
    document.body.classList.remove("player-setup-active");
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

updatePlayerCountPicker();
document.querySelector("#local-form").addEventListener("submit", (event) => {
  event.preventDefault();
  savePlayerName();
});
document.querySelector("#player-name-back").addEventListener("click", closePlayerNameEntry);
playerNameInput.addEventListener("input", () => playerNameInput.setCustomValidity(""));

function applyStartMode() {
  const mode = document.querySelector("main").dataset.startMode;
  modeChoices.hidden = Boolean(mode);
  modePanels.local.hidden = mode !== "local";
  modePanels.online.hidden = mode !== "online";
  optionsPanel.hidden = false;
  if (mode === "local") showPlayerCountPicker();
}

applyStartMode();

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
  persistGameSession();
  localGameStarted = false;
  chiefDrawShown = false;
  chiefDrawAcknowledged = false;
  chiefInstructionsAcknowledged = false;
  pendingPrivateGameResult = null;
  privateGameResultRevealed = false;
  allowPrivateLoversResult = false;
  seenPrivateGameResults.clear();
  seenWitchVictimResults.clear();
  pendingWitchVictimResultKey = null;
  witchVictimResultRevealed = false;
  document.querySelector("#private-game-result-screen").hidden = true;
  document.querySelector("#witch-victim-result-screen").hidden = true;
  document.body.classList.remove(
    "private-game-result-active",
    "witch-victim-result-active",
  );
  revealedLocalPlayers.clear();
  compositionDirty = false;
  onlineRoleLoaded = false;
  const onlineRoom = room.mode === "online";
  roomWorkspace.classList.toggle("online-room-open", onlineRoom);
  roomWorkspace.classList.toggle("online-room-entered", onlineRoom);
  optionsPanel.hidden = true;
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

function startGameUpdates() {
  refreshGamePanel();
  if (gamePollTimer) window.clearInterval(gamePollTimer);
  gamePollTimer = window.setInterval(refreshGamePanel, 2000);
  if (gameTimerInterval) window.clearInterval(gameTimerInterval);
  gameTimerInterval = window.setInterval(updateGameCountdown, 250);
}

function initializeRoleReveal(room) {
  const title = document.querySelector("#role-reveal-title");
  const instruction = document.querySelector("#role-reveal-instruction");
  document.querySelector("#revealed-role").hidden = true;
  if (room.game?.phase !== "dealing" && !chiefDrawAcknowledged) {
    if (!chiefDrawShown) showChiefDraw(room);
    return;
  }
  if (
    room.game?.phase !== "dealing"
    && !chiefInstructionsAcknowledged
    && (room.mode === "local" || room.viewer_is_chief)
  ) {
    showChiefInstructions();
    return;
  }
  if (room.mode === "local") {
    document.querySelector("#online-role-flow").hidden = true;
    document.querySelector("#local-role-flow").hidden = room.game?.phase !== "dealing";
    gamePanel.hidden = room.game?.phase === "dealing";
    if (room.game?.phase !== "dealing" && localGameStarted) {
      startGameUpdates();
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
  startGameUpdates();
}

function showChiefDraw(room) {
  chiefDrawShown = true;
  document.body.classList.remove("role-board-active", "role-reveal-active", "next-player-entry-active");
  const chiefIndex = room.game?.chief_index;
  const chief = Number.isInteger(chiefIndex) ? room.players[chiefIndex] : null;
  if (!chief) {
    chiefDrawAcknowledged = true;
    chiefInstructionsAcknowledged = true;
    initializeRoleReveal(room);
    return;
  }

  const screen = document.querySelector("#chief-draw-screen");
  const card = document.querySelector("#chief-draw-card");
  const initial = document.querySelector("#chief-draw-initial");
  const status = document.querySelector("#chief-draw-status");
  const continueButton = document.querySelector("#chief-draw-continue");
  document.querySelector("#online-role-flow").hidden = true;
  document.querySelector("#local-role-flow").hidden = true;
  gamePanel.hidden = true;
  document.body.classList.add("game-session", "chief-draw-active");
  document.querySelector("#back-button").textContent = "Quitter la partie";
  screen.hidden = false;
  continueButton.hidden = true;
  card.classList.remove("is-revealed");
  card.classList.add("is-drawing");
  initial.textContent = "?";
  status.textContent = "Le sort choisit le Chef du village…";

  if (chiefDrawTimer) window.clearInterval(chiefDrawTimer);
  chiefDrawTimer = window.setInterval(() => {
    const candidate = room.players[Math.floor(Math.random() * room.players.length)];
    initial.textContent = candidate.name.trim().charAt(0).toLocaleUpperCase("fr") || "?";
  }, 110);
  window.setTimeout(() => {
    window.clearInterval(chiefDrawTimer);
    chiefDrawTimer = null;
    card.classList.remove("is-drawing");
    card.classList.add("is-revealed");
    initial.textContent = chief.name.trim().charAt(0).toLocaleUpperCase("fr") || "?";
    status.textContent = `${chief.name} est désigné Chef du village.`;
    continueButton.hidden = false;
  }, 1800);
}

function showChiefInstructions() {
  document.querySelector("#chief-draw-screen").hidden = true;
  document.querySelector("#online-role-flow").hidden = true;
  document.querySelector("#local-role-flow").hidden = true;
  document.querySelector("#chief-instructions-screen").hidden = false;
  gamePanel.hidden = true;
  document.body.classList.remove("chief-draw-active", "role-reveal-active", "role-board-active");
  document.body.classList.add("game-session", "chief-instructions-active");
  document.querySelector("#back-button").textContent = "Quitter la partie";
}

function gamePhaseLabel(phase) {
  return {
    dealing: "Distribution des rôles",
    cupidon: "Cupidon choisit les amoureux",
    couple: "La première aube",
    night: "La nuit tombe",
    day: "Le village se réveille",
    hunter: "Dernier tir du Chasseur",
    chief: "Le Chef du village tranche",
    finished: "Partie terminée",
  }[phase] || "Partie en cours";
}

function finishGameAudioField(cueId) {
  if (cueId !== currentGameAudioCueId) return;
  if (gameAudioFallbackTimer) window.clearTimeout(gameAudioFallbackTimer);
  gameAudioFallbackTimer = null;
  document.querySelector("#game-audio-field").hidden = true;
  document.body.classList.remove("game-audio-visible");
}

function attachFrenchVoice(utterance) {
  const applyFrenchVoice = () => {
    const frenchVoice = (window.speechSynthesis.getVoices?.() || []).find(
      (voice) => (voice.lang || "").toLowerCase().startsWith("fr"),
    );
    if (frenchVoice) {
      utterance.voice = frenchVoice;
      window.speechSynthesis.removeEventListener?.("voiceschanged", applyFrenchVoice);
    }
  };
  utterance.lang = "fr-FR";
  applyFrenchVoice();
  if (!(window.speechSynthesis.getVoices?.().length)) {
    window.speechSynthesis.addEventListener?.("voiceschanged", applyFrenchVoice);
  }
}

function speakGameMaster(text, force = false) {
  if ((!gameVoiceEnabled && !force) || !text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const cueId = ++currentGameAudioCueId;
  const audioField = document.querySelector("#game-audio-field");
  audioField.hidden = false;
  document.body.classList.add("game-audio-visible");
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.rate = 0.94;
  utterance.onend = () => finishGameAudioField(cueId);
  utterance.onerror = () => finishGameAudioField(cueId);
  gameAudioFallbackTimer = window.setTimeout(
    () => finishGameAudioField(cueId),
    90000,
  );
  attachFrenchVoice(utterance);
  window.speechSynthesis.speak(utterance);
}

function formatCountdown(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updateGameCountdown() {
  const countdown = document.querySelector("#game-countdown");
  const progress = document.querySelector("#game-clock-progress");
  if (!currentGameTimer) {
    countdown.hidden = true;
    progress.style.width = "0%";
    return;
  }
  countdown.hidden = false;
  const remaining = Math.max(
    0,
    Math.ceil(currentGameTimer.deadline - Date.now() / 1000),
  );
  countdown.textContent = remaining
    ? formatCountdown(remaining)
    : "00:00";
  countdown.setAttribute(
    "aria-label",
    remaining ? `${formatCountdown(remaining)} restantes` : "Temps écoulé, résolution en cours",
  );
  progress.style.width = `${Math.min(
    100,
    Math.max(0, (1 - remaining / currentGameTimer.duration) * 100),
  )}%`;
  countdown.classList.toggle("is-urgent", remaining <= 30);
  const halfway = currentGameTimer.duration / 2;
  if (
    currentGameAction
    && currentGameTimerPreviousRemaining !== null
    && currentGameTimerPreviousRemaining > halfway
    && remaining <= halfway
    && reminderSpokenForTimer !== currentGameTimer.id
  ) {
    reminderSpokenForTimer = currentGameTimer.id;
    speakGameMaster(currentGameAction.prompt, true);
  }
  currentGameTimerPreviousRemaining = remaining;
}

function actionVerb(action, fieldName) {
  if (fieldName === "first_target" || fieldName === "second_target") return "lier";
  if (fieldName === "kill_target") return "empoisonner";
  return {
    chief_successor: "désigner",
    chief_tiebreak: "bannir",
    vote: "bannir",
    wolf_vote: "dévorer",
    enrage: "infecter",
    white_wolf: "éliminer",
    seer: "sonder",
    hunter: "éliminer",
  }[action.kind] || "choisir";
}

function gameSelectionColor(action, fieldName) {
  if (action.kind === "chief_successor") return "#edc678";
  if (action.kind === "witch_save" && fieldName === "save") return "#edc678";
  if (["vote", "wolf_vote", "white_wolf", "hunter", "chief_tiebreak"].includes(action.kind)) {
    return "#d94b72";
  }
  if (fieldName === "kill_target") return "#d94b72";
  if (action.kind === "cupidon") return "#dc688b";
  return "#d94b72";
}

function gameActionModalTitle(action) {
  return {
    wolf_vote: "Victime de la meute",
    cupidon: "Personne à lier",
    white_wolf: "Victime du Loup Blanc",
    hunter: "Personne dans ton viseur",
    seer: "Joueur à observer",
    witch_save: "Potion de vie",
    witch_poison: "Potion de mort",
    witch_pass: "Potions épuisées",
    enrage: "Personne à contaminer",
    vote: "Personne à bannir",
    chief_tiebreak: "Personne à départager",
    chief_successor: "Personne à désigner Chef",
  }[action.kind] || action.prompt;
}

function renderPlayerChoiceFields(container, fields, action) {
  const section = document.createElement("section");
  section.className = "game-target-picker";
  fields.forEach((field) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = field.name;
    input.dataset.gameRequired = String(field.required);
    input.value = gameActionSelections.get(field.name) || "";
    section.append(input);
  });

  const scroll = document.createElement("div");
  scroll.className = "game-target-scroll";
  const choices = document.createElement("div");
  choices.className = "game-player-choices";
  choices.setAttribute(
    "aria-label",
    fields.length > 1 ? "Choisis deux amoureux" : fields[0].label,
  );
  const aliveIndices = new Set(currentGameResponse?.state?.alive_indices || []);
  const eligibleIndices = new Set(
    fields.flatMap((field) => field.options
      .filter((option) => option.value !== "")
      .map((option) => option.value)),
  );

  activeRoomView?.players.forEach((player, index) => {
    const value = String(index);
    const alive = aliveIndices.has(index);
    const eligible = eligibleIndices.has(value);
    const selectedFields = fields.filter(
      (field) => gameActionSelections.get(field.name) === value,
    );
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-player-choice";
    if (!alive) button.classList.add("is-eliminated");
    button.dataset.gamePlayerChoice = value;
    button.style.setProperty("--tile-hue", `${(index * 74 + 18) % 360}`);
    button.disabled = !alive || !eligible;
    button.setAttribute("aria-pressed", String(selectedFields.length > 0));
    if (selectedFields.length) {
      button.style.setProperty(
        "--selection-color",
        gameSelectionColor(action, selectedFields[0].name),
      );
    }
    const avatar = document.createElement("div");
    avatar.className = "game-player-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = player.name.trim().charAt(0).toUpperCase() || "?";
    const name = document.createElement("span");
    name.className = "game-player-name";
    name.textContent = player.name;
    const number = document.createElement("span");
    number.className = "game-player-number";
    number.textContent = `#${String(index + 1).padStart(2, "0")}`;
    const status = document.createElement("span");
    status.className = "game-player-status";
    status.textContent = !alive
      ? "Éliminé"
      : !eligible
        ? "Indisponible"
        : selectedFields.length > 1
          ? "Amoureux 1 + 2"
          : selectedFields.length === 1
            ? fields.length > 1
              ? selectedFields[0].name === "first_target" ? "Amoureux 1" : "Amoureux 2"
              : "Sélectionné"
            : "Disponible";
    button.append(avatar, name, number, status);
    choices.append(button);
  });

  scroll.append(choices);
  section.append(scroll);
  container.append(section);
}

function renderActionOptionField(container, field) {
  const label = document.createElement("label");
  label.className = "visually-hidden";
  label.textContent = field.label;
  const select = document.createElement("select");
  select.className = "game-player-select";
  select.name = field.name;
  select.dataset.gameRequired = String(field.required);
  field.options.forEach((option) => {
    const choice = document.createElement("option");
    choice.value = option.value;
    choice.textContent = option.label;
    select.append(choice);
  });
  select.value = gameActionSelections.get(field.name) ?? field.options[0]?.value ?? "";
  label.append(select);
  container.append(label);

  const choices = document.createElement("div");
  choices.className = "game-action-options";
  choices.setAttribute("aria-label", field.label);
  field.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-action-option";
    button.dataset.gameOption = field.name;
    button.dataset.optionValue = option.value;
    button.setAttribute("aria-pressed", String(select.value === option.value));
    button.textContent = field.name === "save"
      ? option.value === "yes" ? "Sauver la victime" : "Ne rien faire"
      : option.label;
    choices.append(button);
  });
  container.append(choices);
}

function gameActionButtonLabel(action, targetFields) {
  const selectedTargets = targetFields.map((field) => ({
    field,
    value: gameActionSelections.get(field.name),
  })).filter((selection) => selection.value);
  const targetName = (value) => activeRoomView?.players[Number(value)]?.name || "";

  if (action.kind === "cupidon") {
    return selectedTargets.length === 2
      ? `Lier ${targetName(selectedTargets[0].value)} et ${targetName(selectedTargets[1].value)}`
      : "Choisir les deux amoureux";
  }
  if (!selectedTargets.length) return action.button;
  const { field, value } = selectedTargets[0];
  if (action.kind === "chief_successor") return `Désigner ${targetName(value)} comme Chef`;
  const verb = actionVerb(action, field.name);
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${targetName(value)}`;
}

function finishGameInstruction(instructionKey) {
  if (currentInstructionKey !== instructionKey) return;
  if (instructionSpeechFallback) window.clearTimeout(instructionSpeechFallback);
  instructionSpeechFallback = null;
  document.querySelector("#game-instruction-audio").hidden = true;
  document.querySelector("#game-instruction-continue").hidden = false;
}

function renderGameInstruction(response) {
  const action = response.action;
  const screen = document.querySelector("#game-instruction-screen");
  const continueButton = document.querySelector("#game-instruction-continue");
  const instructionKey = action?.role
    && !["lovers_reveal", "contamination_reveal"].includes(action.kind)
    ? `${response.state.timer?.id || "untimed"}:${action.actor_index}:${action.kind}`
    : null;

  if (!instructionKey) {
    if (currentInstructionKey && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (instructionSpeechFallback) window.clearTimeout(instructionSpeechFallback);
    instructionSpeechFallback = null;
    currentInstructionKey = null;
    acknowledgedInstructionKey = null;
    screen.hidden = true;
    continueButton.hidden = true;
    document.body.classList.remove("game-instruction-active");
    document.body.classList.remove("game-action-active");
    return;
  }

  if (instructionKey === acknowledgedInstructionKey) {
    screen.hidden = true;
    document.body.classList.remove("game-instruction-active");
    document.body.classList.add("game-action-active");
    return;
  }

  screen.hidden = false;
  document.body.classList.add("game-instruction-active");
  document.body.classList.remove("game-action-active");
  if (instructionKey === currentInstructionKey) return;

  currentInstructionKey = instructionKey;
  continueButton.hidden = true;
  document.querySelector("#game-instruction-audio").hidden = false;
  document.querySelector("#game-instruction-role-image").src = action.role.image;
  document.querySelector("#game-instruction-role-image").alt = `Carte ${action.role.name}`;
  document.querySelector("#game-instruction-role-name").textContent = action.role.name;
  document.querySelector("#game-instruction-prompt").textContent = action.prompt;
  if (instructionSpeechFallback) window.clearTimeout(instructionSpeechFallback);

  if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
    finishGameInstruction(instructionKey);
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(action.prompt);
  utterance.lang = "fr-FR";
  utterance.rate = 0.94;
  let speechStarted = false;
  utterance.onstart = () => {
    speechStarted = true;
    if (instructionSpeechFallback) window.clearTimeout(instructionSpeechFallback);
    instructionSpeechFallback = window.setTimeout(
      () => finishGameInstruction(instructionKey),
      90000,
    );
  };
  utterance.onend = () => finishGameInstruction(instructionKey);
  utterance.onerror = () => finishGameInstruction(instructionKey);
  instructionSpeechFallback = window.setTimeout(
    () => {
      if (!speechStarted) finishGameInstruction(instructionKey);
    },
    2500,
  );
  attachFrenchVoice(utterance);
  window.speechSynthesis.speak(utterance);
}

function renderLoversChoice(area, action) {
  const heading = document.createElement("h4");
  heading.className = "lovers-choice-title";
  heading.textContent = action.kind === "contamination_reveal"
    ? "Choisis ton cadre pour vérifier ton état"
    : "Choisis ton cadre pour consulter ton lien";
  const instruction = document.createElement("p");
  instruction.className = "lovers-choice-instruction";
  instruction.textContent = "Chaque joueur touche uniquement sa propre carte, à son tour.";
  const grid = document.createElement("div");
  grid.className = "lovers-choice-grid";
  activeRoomView.players.forEach((player, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "lovers-choice-card";
    card.disabled = index !== action.actor_index;
    card.dataset.privateReveal = String(index);
    card.innerHTML = `<span aria-hidden="true">${player.name.trim().charAt(0).toUpperCase() || "?"}</span><strong></strong>`;
    card.querySelector("strong").textContent = player.name;
    if (index === action.actor_index) card.classList.add("is-current");
    grid.append(card);
  });
  area.append(heading, instruction, grid);
}

function renderGamePanel(response) {
  currentGameResponse = response;
  const state = response.state;
  const timer = state.timer;
  const actionKey = response.action
    ? `${timer?.id || "untimed"}:${response.action.actor_index}:${response.action.kind}`
    : null;
  const timerChanged = timer?.id !== currentGameTimerId;
  if (timerChanged || actionKey !== currentGameActionKey) {
    gameActionSelections.clear();
    pendingGameConfirmation = null;
  }
  if (timerChanged) {
    currentGameTimerId = timer?.id || null;
    reminderSpokenForTimer = null;
    currentGameTimerPreviousRemaining = timer
      ? Math.max(0, Math.ceil(timer.deadline - Date.now() / 1000))
      : null;
  }
  currentGameActionKey = actionKey;
  currentGameTimer = timer;
  currentGameAction = response.action;
  const phaseIcons = {
    cupidon: "♡",
    couple: "∞",
    night: "☾",
    day: "☀",
    hunter: "⚡",
    chief: "★",
    finished: "✦",
    dealing: "✧",
  };
  gamePanel.dataset.phase = state.phase;
  document.body.dataset.gamePhase = state.phase;
  const gameSessionActive = Boolean(activeRoomView?.started && state.phase !== "dealing");
  document.body.classList.toggle("game-session", gameSessionActive);
  syncGameBackHistory(gameSessionActive);
  document.querySelector("#back-button").textContent =
    document.body.classList.contains("game-session")
      ? "Quitter la partie"
      : "← Choisir un mode";
  document.querySelector("#game-phase-icon").textContent =
    phaseIcons[state.phase] || "✦";
  if (timerChanged) {
    if (response.action) {
      lastGameSpokenMessage = null;
    } else {
      speakGameMaster(state.message);
      lastGameSpokenMessage = state.message;
    }
  } else if (
    !response.action
    && state.message !== lastGameSpokenMessage
  ) {
    lastGameSpokenMessage = state.message;
    speakGameMaster(state.message);
  } else if (response.action && reminderSpokenForTimer === timer?.id) {
    currentGameAction = response.action;
  }
  document.querySelector("#game-round").textContent = state.phase === "chief"
    ? "DÉCISION"
    : state.phase === "couple"
      ? `AUBE ${state.round}`
      : ["day", "hunter"].includes(state.phase) ? `JOUR ${state.round}` : `NUIT ${state.round}`;
  document.querySelector("#game-phase-title").textContent = gamePhaseLabel(state.phase);
  document.querySelector("#game-message").textContent = state.message;
  renderGameInstruction(response);
  const privateResult = getPrivateGameResult(response);
  const privateResultAllowed = !["lovers_reveal", "contamination_reveal"].includes(response.action?.kind)
    || allowPrivateLoversResult;
  if (privateResult && privateResultAllowed && !seenPrivateGameResults.has(privateResult.id)) {
    if (pendingPrivateGameResult?.id !== privateResult.id) {
      privateGameResultRevealed = false;
    }
    pendingPrivateGameResult = privateResult;
    allowPrivateLoversResult = false;
    renderPrivateGameResult(privateResult);
  }
  const witchActionKey = response.action?.kind === "witch_save" ? actionKey : null;
  const witchInstructionKey = response.action?.role
    ? `${timer?.id || "untimed"}:${response.action.actor_index}:${response.action.kind}`
    : null;
  const witchInstructionAcknowledged = (
    !witchInstructionKey
    || acknowledgedInstructionKey === witchInstructionKey
  );
  if (
    witchActionKey
    && witchInstructionAcknowledged
    && !seenWitchVictimResults.has(witchActionKey)
  ) {
    if (pendingWitchVictimResultKey !== witchActionKey) {
      witchVictimResultRevealed = false;
    }
    pendingWitchVictimResultKey = witchActionKey;
    renderWitchVictimResult(response.action);
  } else if (pendingWitchVictimResultKey && witchActionKey !== pendingWitchVictimResultKey) {
    pendingWitchVictimResultKey = null;
    witchVictimResultRevealed = false;
    document.querySelector("#witch-victim-result-screen").hidden = true;
    document.body.classList.remove("witch-victim-result-active");
  }
  document.querySelector("#game-progress").textContent =
    state.phase === "day"
      ? `Votes reçus : ${state.votes_received}/${state.vote_total}`
      : state.current_actor ? `Action en cours : ${state.current_actor}` : "";
  const deaths = document.querySelector("#game-deaths");
  deaths.replaceChildren();
  deaths.hidden = !state.deaths.length;
  if (state.deaths.length) {
    const heading = document.createElement("strong");
    heading.textContent = `${state.deaths.length} joueur${state.deaths.length > 1 ? "s" : ""} éliminé${state.deaths.length > 1 ? "s" : ""}`;
    const list = document.createElement("ul");
    state.deaths.forEach((death, index) => {
      const item = document.createElement("li");
      const marker = document.createElement("span");
      marker.className = "game-death-marker";
      marker.setAttribute("aria-hidden", "true");
      marker.style.setProperty("--tile-hue", `${(index * 61 + 346) % 360}`);
      marker.textContent = death.name.trim().charAt(0).toUpperCase() || "?";
      const details = document.createElement("span");
      details.className = "game-death-details";
      const name = document.createElement("strong");
      name.textContent = death.name;
      const cause = document.createElement("span");
      cause.textContent = death.cause;
      details.append(name, cause);
      item.append(marker, details);
      list.append(item);
    });
    deaths.append(heading, list);
  }

  const area = document.querySelector("#game-action-area");
  area.replaceChildren();
  const action = response.action;
  area.dataset.action = action?.kind || "waiting";
  if (["lovers_reveal", "contamination_reveal"].includes(action?.kind)) {
    renderLoversChoice(area, action);
  } else if (action) {
    const form = document.createElement("form");
    form.id = "game-action-form";
    const modal = document.createElement("section");
    modal.className = "game-choice-modal";
    const modalTitle = document.createElement("h4");
    modalTitle.className = "game-choice-modal-title";
    modalTitle.textContent = gameActionModalTitle(action);
    const scroll = document.createElement("div");
    scroll.className = "game-choice-modal-scroll";
    const targetFieldNames = ["target", "first_target", "second_target", "kill_target"];
    const targetFields = action.fields.filter((field) => targetFieldNames.includes(field.name));
    const optionFields = action.fields.filter((field) => !targetFieldNames.includes(field.name));
    if (targetFields.length) renderPlayerChoiceFields(scroll, targetFields, action);
    optionFields.forEach((field) => renderActionOptionField(scroll, field));
    modal.append(modalTitle, scroll);
    form.append(modal);

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary-button game-action-submit";
    submit.textContent = gameActionButtonLabel(action, targetFields);
    const incomplete = [...form.querySelectorAll("select, input[data-game-required='true']")]
      .some((control) => (control.required || control.dataset.gameRequired === "true") && !control.value);
    const hasTarget = targetFields.some((field) => gameActionSelections.get(field.name));
    const hasWitchSaveChoice = action.kind === "witch_save"
      && Boolean(gameActionSelections.get("save"));
    submit.disabled = incomplete || !(hasTarget || hasWitchSaveChoice);
    const footer = document.createElement("div");
    footer.className = "game-choice-modal-footer";
    footer.append(submit);

    const doNothing = document.createElement("button");
    doNothing.type = "button";
    doNothing.className = "secondary-button game-action-do-nothing";
    doNothing.dataset.gameDoNothing = "true";
    doNothing.textContent = ["witch_pass", "witch_save"].includes(action.kind)
      ? "Continuer sans agir"
      : "Ne rien faire";
    if (
      action.kind !== "cupidon"
      && !action.mandatory
      && !(action.kind === "witch_save" && optionFields.length)
    ) footer.append(doNothing);

    const status = document.createElement("p");
    status.className = "game-action-status";
    status.id = "game-action-status";
    form.append(footer, status);
    area.append(form);
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
  updateGameCountdown();
}

function getPrivateGameResult(response) {
  if (response.private_role_result) {
    return {
      id: response.private_role_result.id,
      type: "role",
      result: response.private_role_result,
    };
  }
  if (response.private_contamination_result) {
    return {
      id: response.private_contamination_result.id,
      type: "contamination",
      result: response.private_contamination_result,
    };
  }
  if (response.private_pair_result) {
    return {
      id: response.private_pair_result.id,
      type: "pair",
      result: response.private_pair_result,
    };
  }
  if (response.private_result) {
    return {
      id: `notice:${response.state.round}:${response.private_result}`,
      type: "notice",
      result: response.private_result,
    };
  }
  return null;
}

function createPrivateRopePath(svg, pathData, { foreground = false } = {}) {
  const namespace = "http://www.w3.org/2000/svg";
  const core = document.createElementNS(namespace, "path");
  core.setAttribute("d", pathData);
  core.setAttribute("fill", "none");
  core.setAttribute("stroke", foreground ? "#51280f" : "#69340f");
  core.setAttribute("stroke-width", foreground ? "13" : "12");
  core.setAttribute("stroke-linecap", "round");
  core.setAttribute("stroke-linejoin", "round");
  core.style.filter = "drop-shadow(0 2px 2px #000b)";
  svg.append(core);

  const highlight = document.createElementNS(namespace, "path");
  highlight.setAttribute("d", pathData);
  highlight.setAttribute("fill", "none");
  highlight.setAttribute("stroke", "#c88e48");
  highlight.setAttribute("stroke-width", foreground ? "8" : "7");
  highlight.setAttribute("stroke-linecap", "round");
  highlight.setAttribute("stroke-linejoin", "round");
  highlight.setAttribute("opacity", "0.72");
  svg.append(highlight);

  const length = core.getTotalLength();
  const sampleStep = 2.5;
  const twistPeriod = 20;
  const twistWidth = foreground ? 2.4 : 2;
  for (const strand of [
    { phase: 0, color: "#f4ce7a" },
    { phase: (Math.PI * 2) / 3, color: "#a95e24" },
    { phase: (Math.PI * 4) / 3, color: "#d99a51" },
  ]) {
    let braidedPath = "";
    for (let distance = 0; distance <= length; distance += sampleStep) {
      const point = core.getPointAtLength(distance);
      const before = core.getPointAtLength(Math.max(0, distance - 0.5));
      const after = core.getPointAtLength(Math.min(length, distance + 0.5));
      const tangentX = after.x - before.x;
      const tangentY = after.y - before.y;
      const tangentLength = Math.hypot(tangentX, tangentY) || 1;
      const offset = Math.sin((distance / twistPeriod) * Math.PI * 2 + strand.phase) * 3;
      const x = point.x - (tangentY / tangentLength) * offset;
      const y = point.y + (tangentX / tangentLength) * offset;
      braidedPath += `${distance === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    const braid = document.createElementNS(namespace, "path");
    braid.setAttribute("d", braidedPath);
    braid.setAttribute("fill", "none");
    braid.setAttribute("stroke", strand.color);
    braid.setAttribute("stroke-width", String(twistWidth));
    braid.setAttribute("stroke-linecap", "round");
    braid.setAttribute("stroke-linejoin", "round");
    svg.append(braid);
  }
}

function layoutPrivatePairRope(players, backRope, frontRope) {
  const container = players.getBoundingClientRect();
  const images = [...players.querySelectorAll(".private-pair-role-image")];
  if (container.width === 0 || container.height === 0 || images.length !== 2) return;

  for (const svg of [backRope, frontRope]) {
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${container.width} ${container.height}`);
  }

  const cards = images.map((image) => {
    const bounds = image.getBoundingClientRect();
    const left = bounds.left - container.left;
    const top = bounds.top - container.top;
    const right = bounds.right - container.left;
    const bottom = bounds.bottom - container.top;
    const radius = Math.min(18, bounds.width * 0.09);
    return { left, top, right, bottom, radius, width: bounds.width, height: bounds.height };
  });

  const loopPath = ({ left, top, right, bottom, width, height }) => {
    const sideOffset = Math.max(7, width * 0.035);
    const topOffset = Math.max(5, height * 0.018);
    const bottomOffset = Math.max(6, height * 0.022);
    return [
      `M ${left + width * 0.2} ${top - topOffset}`,
      `C ${left + width * 0.48} ${top - topOffset - 7} ${right - width * 0.08} ${top - 2} ${right + sideOffset} ${top + height * 0.18}`,
      `C ${right + sideOffset + 5} ${top + height * 0.43} ${right + sideOffset - 2} ${bottom - height * 0.16} ${right - width * 0.08} ${bottom + bottomOffset}`,
      `C ${right - width * 0.34} ${bottom + bottomOffset + 8} ${left + width * 0.1} ${bottom + bottomOffset + 5} ${left - sideOffset} ${bottom - height * 0.16}`,
      `C ${left - sideOffset - 5} ${bottom - height * 0.42} ${left - sideOffset + 2} ${top + height * 0.16} ${left + width * 0.2} ${top - topOffset}`,
    ].join(" ");
  };
  cards.forEach((card) => createPrivateRopePath(backRope, loopPath(card)));

  const [upper, lower] = cards;
  const upperCenterX = (upper.left + upper.right) / 2;
  const lowerCenterX = (lower.left + lower.right) / 2;
  const knotX = (upperCenterX + lowerCenterX) / 2;
  const upperAnchorY = upper.bottom + 2;
  const lowerAnchorY = lower.top - 2;
  const knotY = (upperAnchorY + lowerAnchorY) / 2;
  const braidOffset = Math.min(18, upper.width * 0.08);
  const knotWidth = Math.min(42, upper.width * 0.18);
  const knotHeight = Math.min(34, Math.max(24, (lower.top - upper.bottom) * 0.34));
  const connectorPaths = [
    [
      `M ${upperCenterX - braidOffset} ${upperAnchorY}`,
      `C ${upperCenterX - braidOffset - 12} ${upperAnchorY + 12} ${knotX - knotWidth} ${knotY - knotHeight} ${knotX + knotWidth * 0.72} ${knotY - knotHeight * 0.18}`,
      `C ${knotX + knotWidth} ${knotY + knotHeight * 0.5} ${knotX - knotWidth * 0.68} ${knotY + knotHeight * 0.72} ${knotX - knotWidth * 0.82} ${knotY + knotHeight * 0.12}`,
      `C ${knotX - knotWidth * 0.94} ${knotY - knotHeight * 0.54} ${knotX + knotWidth * 0.6} ${knotY - knotHeight * 0.56} ${knotX + knotWidth * 0.9} ${knotY + knotHeight * 0.18}`,
      `C ${knotX + knotWidth * 0.58} ${knotY + knotHeight * 0.72} ${knotX - knotWidth * 0.12} ${knotY + knotHeight} ${knotX - knotWidth * 0.1} ${knotY + knotHeight * 0.62}`,
      `C ${knotX - knotWidth * 0.08} ${knotY + knotHeight * 0.2} ${knotX + 5} ${lowerAnchorY - 16} ${lowerCenterX + braidOffset} ${lowerAnchorY}`,
    ].join(" "),
    [
      `M ${upperCenterX + braidOffset} ${upperAnchorY}`,
      `C ${upperCenterX + braidOffset + 12} ${upperAnchorY + 12} ${knotX + knotWidth} ${knotY - knotHeight} ${knotX - knotWidth * 0.72} ${knotY - knotHeight * 0.18}`,
      `C ${knotX - knotWidth} ${knotY + knotHeight * 0.5} ${knotX + knotWidth * 0.68} ${knotY + knotHeight * 0.72} ${knotX + knotWidth * 0.82} ${knotY + knotHeight * 0.12}`,
      `C ${knotX + knotWidth * 0.94} ${knotY - knotHeight * 0.54} ${knotX - knotWidth * 0.6} ${knotY - knotHeight * 0.56} ${knotX - knotWidth * 0.9} ${knotY + knotHeight * 0.18}`,
      `C ${knotX - knotWidth * 0.58} ${knotY + knotHeight * 0.72} ${knotX + knotWidth * 0.12} ${knotY + knotHeight} ${knotX + knotWidth * 0.1} ${knotY + knotHeight * 0.62}`,
      `C ${knotX + knotWidth * 0.08} ${knotY + knotHeight * 0.2} ${knotX - 5} ${lowerAnchorY - 16} ${lowerCenterX - braidOffset} ${lowerAnchorY}`,
    ].join(" "),
  ];
  connectorPaths.forEach((pathData) => createPrivateRopePath(backRope, pathData));
  createPrivateRopePath(
    frontRope,
    `M ${knotX - knotWidth * 0.78} ${knotY - knotHeight * 0.08} C ${knotX - 8} ${knotY - knotHeight * 0.62} ${knotX + 8} ${knotY + knotHeight * 0.62} ${knotX + knotWidth * 0.78} ${knotY + knotHeight * 0.08}`,
    { foreground: true },
  );

  const wrapCard = ({ left, top, right, bottom, width, height }, index) => {
    const insetX = width * 0.16;
    const insetY = height * 0.2;
    return [
      `M ${left + insetX} ${top - 3}`,
      `C ${left - 7} ${top + height * 0.12} ${left - 8} ${top + height * 0.36} ${left + width * 0.04} ${top + height * 0.5}`,
      `C ${left + width * 0.12} ${bottom + 10} ${right - width * 0.18} ${bottom + 10} ${right - width * 0.05} ${bottom - height * 0.04}`,
      `C ${right + 8} ${bottom - height * 0.2} ${right + 7} ${top + height * 0.34} ${right - width * 0.04} ${top + height * 0.14}`,
      `C ${right - width * 0.18} ${top - 8} ${left + width * 0.38} ${top - 8} ${left + insetX} ${top - 3}`,
    ].join(" ");
  };
  [upper, lower].forEach((card, index) => {
    createPrivateRopePath(frontRope, wrapCard(card, index), { foreground: true });
  });

  const tieEnds = [
    `M ${upperCenterX - upper.width * 0.28} ${upper.bottom - 2} Q ${upperCenterX} ${upper.bottom + 8} ${upperCenterX} ${upperAnchorY}`,
    `M ${lowerCenterX} ${lowerAnchorY} Q ${lowerCenterX} ${lower.top - 10} ${lowerCenterX + lower.width * 0.28} ${lower.top + 2}`,
  ];
  tieEnds.forEach((pathData) => {
    createPrivateRopePath(frontRope, pathData, { foreground: true });
  });
}

function renderPrivateGameResult(privateResult) {
  if (privatePairRopeObserver) {
    privatePairRopeObserver.disconnect();
    privatePairRopeObserver = null;
  }
  const screen = document.querySelector("#private-game-result-screen");
  const kicker = document.querySelector("#private-game-result-kicker");
  const title = document.querySelector("#private-game-result-title");
  const content = document.querySelector("#private-game-result-content");
  const revealButton = document.querySelector("#private-game-result-reveal");
  const continueButton = document.querySelector("#private-game-result-continue");
  let pairRopes = null;
  content.replaceChildren();
  revealButton.hidden = true;
  continueButton.hidden = false;
  if (privateResult.type === "role" || privateResult.type === "contamination") {
    kicker.textContent = privateResult.type === "role"
      ? "RÉSULTAT DE LA VOYANTE"
      : "RÉSULTAT DE LA CONTAMINATION";
    title.textContent = privateResult.result.player_name;
    const image = document.createElement("img");
    image.className = privateResult.type === "role" ? "private-seer-role-image" : "";
    image.src = privateResult.result.role.image;
    image.alt = `Carte ${privateResult.result.role.name}`;
    content.append(image);
    if (privateResult.type === "contamination") {
      const roleName = document.createElement("h3");
      roleName.textContent = privateResult.result.role.name;
      content.append(roleName);
    }
  } else if (privateResult.type === "pair") {
    kicker.textContent = "LIEN SECRET DE CUPIDON";
    const handoff = activeRoomView?.mode === "local"
      && currentGameResponse?.action?.kind === "lovers_reveal";
    revealButton.hidden = !handoff || privateGameResultRevealed;
    continueButton.hidden = handoff && !privateGameResultRevealed;
    if (handoff && !privateGameResultRevealed) {
      const actorIndex = currentGameResponse.action.actor_index;
      const actorName = activeRoomView.players[actorIndex]?.name || "le joueur concerné";
      title.textContent = `Passe l’appareil à ${actorName}`;
      const instruction = document.createElement("p");
      instruction.textContent = "Appuie sur le bouton lorsque tu es prêt à consulter tes informations en privé.";
      content.append(instruction);
    } else {
      title.textContent = "Vos destins sont liés";
      revealButton.hidden = true;
      continueButton.hidden = false;
      const players = document.createElement("div");
      players.className = "private-pair-players";
      privateResult.result.players.forEach((player, index) => {
        const card = document.createElement("div");
        card.className = `private-pair-player private-pair-player--${index === 0 ? "upper" : "lower"}`;
        const identity = document.createElement("div");
        identity.className = "private-pair-identity";
        const name = document.createElement("strong");
        name.textContent = player.name;
        identity.append(name);
        const image = document.createElement("img");
        image.className = "private-pair-role-image";
        image.src = player.role.image;
        image.alt = `Carte ${player.role.name}`;
        card.append(...(index === 0 ? [identity, image] : [image, identity]));
        players.append(card);
      });
      const loveLink = document.createElement("div");
      loveLink.className = "private-pair-love-link";
      loveLink.setAttribute("aria-label", "Cupidon a lié ces deux joueurs : ils sont amoureux");
      loveLink.innerHTML = '<span aria-hidden="true">♥</span><strong>Amoureux</strong>';
      players.append(loveLink);
      content.append(players);
      pairRopes = { players };
    }
  } else {
    revealButton.hidden = true;
    continueButton.hidden = false;
    kicker.textContent = "CONSULTATION PRIVÉE";
    title.textContent = "Vous êtes sauvé";
    const message = document.createElement("p");
    message.className = "private-notice-result";
    message.textContent = privateResult.result;
    content.append(message);
  }
  screen.hidden = false;
  document.body.classList.add("private-game-result-active");
  if (pairRopes) privatePairRopeObserver = null;
}

function renderWitchVictimResult(action) {
  const screen = document.querySelector("#witch-victim-result-screen");
  const kicker = document.querySelector("#witch-victim-result-kicker");
  const title = document.querySelector("#witch-victim-result-title");
  const content = document.querySelector("#witch-victim-result-content");
  const revealButton = document.querySelector("#witch-victim-result-reveal");
  const continueButton = document.querySelector("#witch-victim-result-continue");
  const handoff = activeRoomView?.mode === "local" && !witchVictimResultRevealed;
  content.replaceChildren();
  kicker.textContent = "CONSULTATION PRIVÉE DE LA SORCIÈRE";
  revealButton.hidden = !handoff;
  continueButton.hidden = handoff;

  if (handoff) {
    const actorName = activeRoomView.players[action.actor_index]?.name || "la Sorcière";
    title.textContent = `Passe l’appareil à ${actorName}`;
    const instruction = document.createElement("p");
    instruction.textContent = "Appuie sur le bouton lorsque tu es prêt à consulter le résultat en privé.";
    content.append(instruction);
  } else if (action.victim) {
    title.textContent = "Victime de la meute";
    const player = document.createElement("div");
    player.className = "witch-victim-result-player";
    const initial = document.createElement("span");
    initial.className = "witch-victim-result-initial";
    initial.textContent = action.victim.initial;
    const name = document.createElement("strong");
    name.textContent = action.victim.name;
    player.append(initial, name);
    content.append(player);
  } else {
    title.textContent = "La meute n’a choisi personne";
    const message = document.createElement("p");
    message.textContent = "Aucune victime n’a été désignée cette nuit.";
    content.append(message);
  }

  screen.hidden = false;
  document.body.classList.add("witch-victim-result-active");
}

async function refreshGamePanel() {
  if (pendingPrivateGameResult || !activeRoom || !activeRoomView?.started || !activeRoomView.game) return;
  try {
    if (activeRoomView.mode === "local") {
      const roomResponse = await fetch(`/api/rooms/${encodeURIComponent(activeRoom)}`);
      const room = await roomResponse.json();
      if (!roomResponse.ok) throw new Error(room.error || "Impossible de retrouver la partie.");
      activeRoomView = room;
    }
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

document.querySelector("#game-action-area").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-private-reveal]");
  if (!button || !activeRoom || !currentGameResponse?.action) return;
  button.disabled = true;
  try {
    const actorIndex = Number(button.dataset.privateReveal);
    const result = await postJson(
      `/api/rooms/${encodeURIComponent(activeRoom)}/game/action`,
      { do_nothing: true, player_index: actorIndex },
    );
    allowPrivateLoversResult = true;
    renderGamePanel(result);
  } catch (error) {
    button.disabled = false;
    lobbyStatus.textContent = error.message;
  }
});

document.querySelector("#game-action-area").addEventListener("submit", async (event) => {
  if (event.target.id !== "game-action-form" || !activeRoom) return;
  event.preventDefault();
  const doNothing = event.target.dataset.doNothing === "true";
  event.target.dataset.doNothing = "false";
  const incomplete = [...event.target.querySelectorAll("select")].some((select) => (
    (select.required || select.dataset.required === "true" || select.dataset.gameRequired === "true")
    && !select.value
  )) || [...event.target.querySelectorAll("input[data-game-required='true']")]
    .some((input) => !input.value);
  if (incomplete && !doNothing) {
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
  payload.do_nothing = doNothing;
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
    const result = await postJson(`/api/rooms/${encodeURIComponent(activeRoom)}/game/action`, payload);
    const privateResult = getPrivateGameResult(result);
    if (privateResult && !seenPrivateGameResults.has(privateResult.id)) {
      if (activeRoomView.mode === "local") {
        const response = await fetch(`/api/rooms/${encodeURIComponent(activeRoom)}`);
        const room = await response.json();
        if (!response.ok) throw new Error(room.error || "Impossible de retrouver la partie.");
        activeRoomView = room;
      }
      renderGamePanel(result);
      return;
    }
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
  if (button.dataset.gamePlayerChoice) {
    const selectedPlayer = button.dataset.gamePlayerChoice;
    const fields = currentGameResponse.action.fields.filter((field) => (
      ["target", "first_target", "second_target", "kill_target"].includes(field.name)
    ));
    if (currentGameResponse.action.kind === "cupidon") {
      const first = gameActionSelections.get("first_target");
      const second = gameActionSelections.get("second_target");
      if (first === selectedPlayer) {
        gameActionSelections.delete("first_target");
        if (second) {
          gameActionSelections.set("first_target", second);
          gameActionSelections.delete("second_target");
        }
      } else if (second === selectedPlayer) {
        gameActionSelections.delete("second_target");
      } else if (!first) {
        gameActionSelections.set("first_target", selectedPlayer);
      } else {
        gameActionSelections.set("second_target", selectedPlayer);
      }
    } else {
      const field = fields.find((candidate) => candidate.options.some(
        (option) => option.value === selectedPlayer,
      ));
      if (field) gameActionSelections.set(field.name, selectedPlayer);
    }
    pendingGameConfirmation = null;
    renderGamePanel(currentGameResponse);
    return;
  }
  if (button.dataset.gameOption) {
    gameActionSelections.set(button.dataset.gameOption, button.dataset.optionValue);
    renderGamePanel(currentGameResponse);
    return;
  }
  if (button.dataset.gameDoNothing) {
    const form = document.querySelector("#game-action-form");
    if (!form) return;
    form.dataset.doNothing = "true";
    form.requestSubmit();
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

  document.body.classList.remove("role-reveal-active", "next-player-entry-active");
  document.body.classList.add("role-board-active");
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
    tile.style.setProperty("--tile-hue", `${(index * 74 + 18) % 360}`);
    tile.setAttribute("aria-label", isRevealed
      ? `Revoir le rôle de ${player.name}`
      : isNamed ? `Voir le rôle de ${player.name}` : `Choisir la case ${index + 1}`);
    if (isNamed) {
      tile.classList.add("deal-tile-named");
      const number = document.createElement("span");
      number.className = "deal-tile-index";
      number.textContent = `#${String(index + 1).padStart(2, "0")}`;
      const initial = document.createElement("span");
      initial.className = "deal-tile-avatar";
      initial.textContent = player.name.trim().charAt(0).toLocaleUpperCase("fr") || "?";
      const name = document.createElement("span");
      name.className = "deal-tile-name";
      name.textContent = player.name;
      tile.append(number, initial, name);
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
  document.body.classList.remove("role-reveal-active", "role-board-active");
  document.body.classList.add("next-player-entry-active");
  document.querySelector("#local-role-board").hidden = true;
  document.querySelector("#deal-card-screen").hidden = true;
  const entry = document.querySelector("#next-player-entry");
  entry.hidden = false;
  document.querySelector("#next-player-title").textContent =
    `Joueur ${String(playerIndex + 1).padStart(2, "0")}, saisis ton pseudo`;
  const input = document.querySelector("#next-player-name");
  input.value = "";
  input.focus();
}

function openLocalRoleCard(playerIndex, isRevealed = false) {
  selectedLocalPlayer = playerIndex;
  document.body.classList.remove("role-board-active", "next-player-entry-active");
  document.body.classList.add("role-reveal-active");
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
    document.querySelector("#deal-card-instruction").textContent =
      "Retiens ton rôle et garde-le secret.";
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
  persistGameSession();
  document.body.classList.remove("role-reveal-active");
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
    persistGameSession();
    renderRoom(room);
      showChiefDraw(room);
  } catch (error) {
    document.querySelector("#local-game-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#chief-draw-continue").addEventListener("click", () => {
  document.querySelector("#chief-draw-screen").hidden = true;
  document.body.classList.remove("chief-draw-active");
  chiefDrawAcknowledged = true;
  persistGameSession();
  if (activeRoomView?.mode === "local" || activeRoomView?.viewer_is_chief) {
    showChiefInstructions();
  } else {
    chiefInstructionsAcknowledged = true;
    if (activeRoomView) initializeRoleReveal(activeRoomView);
  }
});

document.querySelector("#chief-instructions-continue").addEventListener("click", () => {
  chiefInstructionsAcknowledged = true;
  persistGameSession();
  document.querySelector("#chief-instructions-screen").hidden = true;
  document.body.classList.remove("chief-instructions-active");
  if (activeRoomView) initializeRoleReveal(activeRoomView);
});

document.querySelector("#private-game-result-reveal").addEventListener("click", () => {
  if (pendingPrivateGameResult?.type !== "pair") return;
  privateGameResultRevealed = true;
  persistGameSession();
  renderPrivateGameResult(pendingPrivateGameResult);
});

document.querySelector("#private-game-result-continue").addEventListener("click", async () => {
  if (!pendingPrivateGameResult) return;
  const action = currentGameResponse?.action;
  if (
    pendingPrivateGameResult.type === "pair"
    && action?.kind === "lovers_reveal"
  ) {
    const payload = { do_nothing: true };
    if (activeRoomView?.mode === "local") {
      payload.player_index = action.actor_index;
    }
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(activeRoom)}/game/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json();
      if (response.status === 409) {
        const query = activeRoomView?.mode === "local"
          ? `?player_index=${action.actor_index}`
          : "";
        const latestResponse = await fetch(
          `/api/rooms/${encodeURIComponent(activeRoom)}/game${query}`,
        );
        const latest = await latestResponse.json();
        if (!latestResponse.ok) {
          throw new Error(latest.error || "Impossible de vérifier la consultation privée.");
        }
        if (
          latest.action?.kind === "lovers_reveal"
          && latest.action.actor_index === action.actor_index
        ) {
          throw new Error(result.error || "Impossible de terminer la consultation privée.");
        }
      } else if (!response.ok) {
        throw new Error(result.error || "Impossible de terminer la consultation privée.");
      }
    } catch (error) {
      lobbyStatus.textContent = error.message;
      return;
    }
  }
  seenPrivateGameResults.add(pendingPrivateGameResult.id);
  pendingPrivateGameResult = null;
  privateGameResultRevealed = false;
  persistGameSession();
  if (privatePairRopeObserver) {
    privatePairRopeObserver.disconnect();
    privatePairRopeObserver = null;
  }
  document.querySelector("#private-game-result-screen").hidden = true;
  document.body.classList.remove("private-game-result-active");
  await refreshGamePanel();
});

document.querySelector("#witch-victim-result-reveal").addEventListener("click", () => {
  if (!currentGameResponse?.action || !pendingWitchVictimResultKey) return;
  witchVictimResultRevealed = true;
  persistGameSession();
  renderWitchVictimResult(currentGameResponse.action);
});

document.querySelector("#witch-victim-result-continue").addEventListener("click", () => {
  if (!pendingWitchVictimResultKey || !currentGameResponse) return;
  seenWitchVictimResults.add(pendingWitchVictimResultKey);
  pendingWitchVictimResultKey = null;
  witchVictimResultRevealed = false;
  persistGameSession();
  document.querySelector("#witch-victim-result-screen").hidden = true;
  document.body.classList.remove("witch-victim-result-active");
  renderGamePanel(currentGameResponse);
});

document.querySelector("#game-instruction-continue").addEventListener("click", () => {
  if (!currentInstructionKey) return;
  acknowledgedInstructionKey = currentInstructionKey;
  persistGameSession();
  if (instructionSpeechFallback) window.clearTimeout(instructionSpeechFallback);
  instructionSpeechFallback = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  document.querySelector("#game-instruction-screen").hidden = true;
  document.querySelector("#game-instruction-continue").hidden = true;
  document.body.classList.remove("game-instruction-active");
  document.body.classList.add("game-action-active");
  if (currentGameResponse?.action?.kind === "witch_save") {
    renderGamePanel(currentGameResponse);
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

const exitConfirmation = document.querySelector("#exit-confirmation");
const backButton = document.querySelector("#back-button");
function resetGameBackPress() {
  if (gameBackPressTimer) window.clearTimeout(gameBackPressTimer);
  gameBackPressTimer = null;
  gameBackPressArmed = false;
  gameExitHint.hidden = true;
}

function syncGameBackHistory(gameSessionActive) {
  if (gameSessionActive && !gameBackHistoryActive) {
    window.history.pushState({ wolfieGame: true }, "", window.location.href);
    gameBackHistoryActive = true;
  } else if (!gameSessionActive) {
    resetGameBackPress();
    gameBackHistoryActive = false;
  }
}

document.querySelector("#stay-in-game").addEventListener("click", () => {
  exitConfirmation.close();
});
document.querySelector("#confirm-exit").addEventListener("click", async () => {
  exitConfirmation.close();
  await returnToModeSelection();
});
exitConfirmation.addEventListener("close", () => backButton.focus());

async function returnToModeSelection() {
  resetGameBackPress();
  gameBackHistoryActive = false;
  clearPersistedGameSession();
  const destination = activeRoomView?.mode === "local"
    ? "/local"
    : activeRoomView?.mode === "online"
      ? "/online"
      : "/";
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
  window.location.assign(destination);
}

window.addEventListener("popstate", () => {
  if (!document.body.classList.contains("game-session")) return;
  gameBackHistoryActive = false;
  if (gameBackPressArmed) {
    resetGameBackPress();
    void returnToModeSelection();
    return;
  }

  gameBackPressArmed = true;
  gameExitHint.hidden = false;
  window.history.pushState({ wolfieGame: true }, "", window.location.href);
  gameBackHistoryActive = true;
  gameBackPressTimer = window.setTimeout(resetGameBackPress, 2000);
});

backButton.addEventListener("click", async () => {
  if (activeRoomView?.started) {
    exitConfirmation.showModal();
    document.querySelector("#stay-in-game").focus();
    return;
  }
  await returnToModeSelection();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !activeRoomView?.started || exitConfirmation.open) return;
  event.preventDefault();
  exitConfirmation.showModal();
  document.querySelector("#stay-in-game").focus();
});

async function restoreSavedRoom() {
  const storedRoom = readStoredJson(activeRoomStorageKey);
  const currentMode = document.querySelector("main").dataset.startMode;
  if (!storedRoom?.code || storedRoom.mode !== currentMode) return;

  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(storedRoom.code)}`);
    const room = await response.json();
    if (!response.ok) throw new Error(room.error || "Salon introuvable.");
    showLobby(room);
    const storedUi = readStoredJson(gameUiStorageKey) || {};
    privateGameResultRevealed = storedUi.privateGameResultRevealed === true;
    witchVictimResultRevealed = storedUi.witchVictimResultRevealed === true;
    acknowledgedInstructionKey = storedUi.acknowledgedInstructionKey || null;
    chiefDrawShown = storedUi.chiefDrawShown === true;
    chiefDrawAcknowledged = storedUi.chiefDrawAcknowledged === true;
    chiefInstructionsAcknowledged = storedUi.chiefInstructionsAcknowledged === true;
    localGameStarted = storedUi.localGameStarted === true;
    selectedLocalPlayer = Number.isInteger(storedUi.selectedLocalPlayer)
      ? storedUi.selectedLocalPlayer
      : null;
    revealedLocalPlayers.clear();
    (room.local_role_viewed_indices || []).forEach((index) => revealedLocalPlayers.add(index));
    (storedUi.revealedLocalPlayers || []).forEach((index) => revealedLocalPlayers.add(index));
    if (room.started) {
      localGameStarted = room.mode === "local"
        && (localGameStarted || room.game?.phase !== "dealing");
      initializeRoleReveal(room);
    }
  } catch {
    clearPersistedGameSession();
  }
}

void restoreSavedRoom();
