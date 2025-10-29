import { CONFIG } from '../config';
import { setPlayerLife, getPlayerLife } from '../services/remote-lives';
import { getPlayer } from '@dcl/sdk/players';
import { initDiamondsForPlayer } from '../diamonds/diamonds';
import { movePlayerTo } from '~system/RestrictedActions';
import { Vector3 } from '@dcl/sdk/math';
import { getTerrainHeight } from '../utils/terrain-height-loader';
import { isLoadingFinished } from './loading-manager';
import { updatePlayerLives, updatePlayerDiamonds, updateNextRegenTime, hideLoadingScreen, updatePlayerStamina } from '../ui';
import { getStaminaPercentage } from './stamina-simple';
import { engine } from '@dcl/sdk/ecs';
import { getDiamondsCollected } from '../diamonds/diamonds';
import { initDeathSystem, createDeathDetectionSystem } from './death';

// TypeScript/DCL SDK7 compatibility (fixes Cannot find name 'localStorage')
declare const localStorage: { getItem: (k: string) => string | null, setItem: (k: string, v: string) => void } | undefined;

// Safe localStorage helpers for SDK7
function safeGetItem(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
function safeSetItem(key: string, val: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, val); } catch {}
}

function now() { return Date.now(); }

export const PlayerUI = {
  name: 'Player',
  address: '',
  lives: CONFIG.PLAYER.LIVES,
  maxLives: CONFIG.PLAYER.maxLives,
  lastRegen: 0, // timestamp de la dernière régénération (gardé pour compatibilité)
  regenQueue: [] as number[], // Queue des timestamps de régénération pour chaque vie perdue
  alreadyLaunched: false, // prevent double addSystem

  async init(lives: number, name: string, address: string) {
    PlayerUI.name = name || 'Player';
    PlayerUI.address = address;
    
    
    // Essayer de charger depuis Firebase
    const remote = await getPlayerLife(address);
    // console.log(`[PLAYER] Firebase response for ${address}:`, JSON.stringify(remote)); // Réduit les logs pour éviter "Message too large"
    
    if (remote && typeof remote.lives !== 'undefined') {
      // Firebase disponible - charger les données
      PlayerUI.lives = Math.max(0, Math.min(remote.lives, CONFIG.PLAYER.maxLives));
      PlayerUI.lastRegen = remote.lastRegen || now();
      PlayerUI.regenQueue = (remote.regenQueue || []).filter((t: number) => t > now());
      // Si la queue est absente/vide mais qu'il manque des vies, reconstruire des timers restants
      if (PlayerUI.regenQueue.length === 0 && PlayerUI.lives < PlayerUI.maxLives) {
        const missing = PlayerUI.maxLives - PlayerUI.lives;
        const base = now();
        for (let i = 1; i <= missing; i++) {
          PlayerUI.regenQueue.push(base + i * (CONFIG.PLAYER.LIFE_REGEN_MINUTES * CONFIG.PLAYER.MS_IN_MIN));
        }
        // Persister la queue reconstruite
        await setPlayerLife(address, PlayerUI.name, PlayerUI.lives, PlayerUI.lastRegen, PlayerUI.regenQueue);
      }
      // console.log(`[DEBUG_FIREBASE] 🔍 Loaded from Firebase: lives=${PlayerUI.lives}, regenQueue.length=${PlayerUI.regenQueue.length}, rawQueue=${remote.regenQueue ? remote.regenQueue.length : 'undefined'}`);
      // if (remote.regenQueue && remote.regenQueue.length > 0) {
      //   console.log(`[DEBUG_FIREBASE] 🔍 Raw queue timestamps:`, remote.regenQueue.map((t: number) => ({ timestamp: t, timeUntil: Math.round((t - now()) / 1000) + 's' })));
      // }
      // console.log(`[PLAYER] ✅ DON'T save to Firebase - data already exists`); // Réduit les logs pour éviter 'Message too large'
      
      // NE RIEN SAUVEGARDER si on a déjà des données Firebase
    } else {
      // Firebase indisponible - créer les données initiales
      PlayerUI.lives = lives;
      PlayerUI.lastRegen = now();
      // console.log(`[PLAYER] ⚠️ No Firebase data, creating new player with ${PlayerUI.lives} lives`); // Réduit les logs pour éviter 'Message too large'
      
      // UNIQUEMENT ici on sauvegarde dans Firebase pour créer l'entrée
      const saved = await setPlayerLife(address, PlayerUI.name, PlayerUI.lives, PlayerUI.lastRegen, PlayerUI.regenQueue);
      if (!saved) {
        // Fallback local si Firebase échoue
        safeSetItem('lives', PlayerUI.lives.toString());
        safeSetItem('lastRegen', PlayerUI.lastRegen.toString());
        // console.log(`[PLAYER] 💾 Saved to local cache`); // Réduit les logs pour éviter 'Message too large'
      } else {
        // console.log(`[PLAYER] 💾 Saved to Firebase`); // Réduit les logs pour éviter 'Message too large'
      }
    }
    
    PlayerUI.maxLives = CONFIG.PLAYER.maxLives;

    // ✅ CATCH-UP IMMÉDIAT: appliquer les régénérations déjà dues
    {
      let didCatchup = false;
      while (PlayerUI.regenQueue.length > 0 && PlayerUI.lives < PlayerUI.maxLives) {
        const next = PlayerUI.regenQueue[0];
        if (now() < next) break;
        PlayerUI.regenQueue.shift();
        await PlayerUI.gainLife();
        didCatchup = true;
      }
      if (didCatchup) {
        await setPlayerLife(address, PlayerUI.name, PlayerUI.lives, PlayerUI.lastRegen, PlayerUI.regenQueue);
      }
    }

    PlayerUI.launchRegenSystem();
    
    
    // Mettre à jour l'UI
    updatePlayerLives(PlayerUI.lives, PlayerUI.maxLives);
    
  },

  async loseLife() {
    if (PlayerUI.lives > 0) {
      PlayerUI.lives--;
      
      // ✅ NOUVEAU: Ajouter un timer de régénération pour cette vie perdue
      const regenTime = now() + (CONFIG.PLAYER.LIFE_REGEN_MINUTES * CONFIG.PLAYER.MS_IN_MIN);
      PlayerUI.regenQueue.push(regenTime);
      PlayerUI.regenQueue.sort((a, b) => a - b); // Trier par ordre chronologique
      
      // console.log(`[DEBUG_LOSE] ❌ Vie perdue: ${PlayerUI.lives + 1} → ${PlayerUI.lives}, queue.length=${PlayerUI.regenQueue.length}`);
      
      // console.log(`[LOSE_LIFE] ❌ Vie perdue ! Nouvelles vies: ${PlayerUI.lives}/${PlayerUI.maxLives}`);
      // console.log(`[LOSE_LIFE] 🔄 Régénération programmée dans 1 minute (${PlayerUI.regenQueue.length} vies en attente)`);
      
      // Mettre à jour l'UI
      updatePlayerLives(PlayerUI.lives, PlayerUI.maxLives);
      
      // Sauvegarder avec fallback local (inclure la queue de régénération)
      const saved = await setPlayerLife(PlayerUI.address, PlayerUI.name, PlayerUI.lives, PlayerUI.lastRegen, PlayerUI.regenQueue);
      if (!saved) {
        // Fallback local si Firebase échoue
        safeSetItem('lives', PlayerUI.lives.toString());
        safeSetItem('lastRegen', PlayerUI.lastRegen.toString());
        safeSetItem('regenQueue', JSON.stringify(PlayerUI.regenQueue));
        // console.log(`[LOSE_LIFE] 💾 Fallback local activé`);
      } else {
        // console.log(`[LOSE_LIFE] ✅ État sauvegardé sur Firebase (${PlayerUI.lives} lives)`);
      }
    }
  },

  async gainLife() {
    // console.log(`[DEBUG_GAIN] 📥 Called with lives=${PlayerUI.lives}, maxLives=${PlayerUI.maxLives}`);
    
    if (PlayerUI.lives < PlayerUI.maxLives) {
      PlayerUI.lives++;
      // ✅ SUPPRIMÉ: PlayerUI.lastRegen = now(); // Plus besoin de mettre à jour le timestamp global
      
      // console.log(`[DEBUG_GAIN] ✅ Vie gagnée ! Nouvelles vies: ${PlayerUI.lives}/${PlayerUI.maxLives}`);
      
      // Mettre à jour l'UI
      updatePlayerLives(PlayerUI.lives, PlayerUI.maxLives);
      
      // Sauvegarder avec fallback local
      const saved = await setPlayerLife(PlayerUI.address, PlayerUI.name, PlayerUI.lives, PlayerUI.lastRegen, PlayerUI.regenQueue);
      if (!saved) {
        // Fallback local si Firebase échoue
        safeSetItem('lives', PlayerUI.lives.toString());
        safeSetItem('lastRegen', PlayerUI.lastRegen.toString());
        safeSetItem('regenQueue', JSON.stringify(PlayerUI.regenQueue));
        // console.log(`[GAIN_LIFE] 💾 Fallback local activé`);
      } else {
        // console.log(`[GAIN_LIFE] ✅ État sauvegardé sur Firebase`);
      }
    } else {
      // console.log(`[DEBUG_GAIN] ❌ Max vies atteint (${PlayerUI.maxLives}/${PlayerUI.maxLives})`);
    }
  },

  canExitSafeCenter() {
    return PlayerUI.lives > 0;
  },

  launchRegenSystem() {
    if (PlayerUI.alreadyLaunched) return;
    PlayerUI.alreadyLaunched = true;
    let acc = 0;
    const { LIFE_REGEN_MINUTES } = CONFIG.PLAYER;
    
    
    // Fire-and-forget loop, never async inside addSystem
    import('@dcl/sdk/ecs').then(({engine}) => {
      engine.addSystem((dt) => {
        acc += dt;
        if (acc > 2.5) {
          void PlayerUI.regenTick();
          acc = 0;
        }
      });
    });
  },

  async regenTick() {
    // ✅ Régénération basée sur la queue de timers, avec purge même à maxLives
    const nowTime = now();
    let purged = false;

    // console.log(`[DEBUG_REGEN] 🔍 Tick: lives=${PlayerUI.lives}, queue.length=${PlayerUI.regenQueue.length}, next=${PlayerUI.regenQueue.length > 0 ? Math.round((PlayerUI.regenQueue[0] - nowTime) / 1000) : 'none'}s`);

    while (PlayerUI.regenQueue.length > 0) {
      const nextRegenTime = PlayerUI.regenQueue[0];
      if (nowTime < nextRegenTime) break;

      // Le timer en tête est expiré
      PlayerUI.regenQueue.shift();
      // console.log(`[DEBUG_REGEN] ⏰ Timer expired! lives=${PlayerUI.lives}, maxLives=${PlayerUI.maxLives}`);
      
      if (PlayerUI.lives < PlayerUI.maxLives) {
        await PlayerUI.gainLife();
        // console.log(`[DEBUG_REGEN] ✅ After gainLife: lives=${PlayerUI.lives}, queue.length=${PlayerUI.regenQueue.length}`);
      } else {
        purged = true; // Purge silencieuse quand déjà à max
        // console.log(`[DEBUG_REGEN] 🧹 Purged (already at max)`);
      }
    }

    // Si on a purgé des entrées sans gain de vie, persister l'état
    if (purged) {
      await setPlayerLife(PlayerUI.address, PlayerUI.name, PlayerUI.lives, PlayerUI.lastRegen, PlayerUI.regenQueue);
    }
  },

  nextRegenIn() {
    if (PlayerUI.lives >= PlayerUI.maxLives) return 0;
    if (PlayerUI.regenQueue.length === 0) return 0;
    
    const nowTime = now();
    const nextRegenTime = PlayerUI.regenQueue[0];
    const timeLeftMs = Math.max(0, nextRegenTime - nowTime);
    return timeLeftMs / 1000; // Convertir en secondes pour l'UI
  },

  // FONCTION DE DEBUG : Forcer la régénération
  async forceRegen() {
    if (PlayerUI.lives < PlayerUI.maxLives) {
      await PlayerUI.gainLife();
    } else {
    }
  },

  // FONCTION DE RÉCUPÉRATION : Charger depuis le cache local
  loadFromLocalCache() {
    const localLives = parseInt(safeGetItem('lives') || CONFIG.PLAYER.LIVES.toString());
    const localLastRegen = parseInt(safeGetItem('lastRegen') || now().toString());
    const localRegenQueue = JSON.parse(safeGetItem('regenQueue') || '[]') as number[];
    
    PlayerUI.lives = Math.max(0, Math.min(localLives, PlayerUI.maxLives));
    PlayerUI.lastRegen = localLastRegen;
    PlayerUI.regenQueue = localRegenQueue.filter(time => time > now()); // Nettoyer les timers expirés
    
    // Mettre à jour l'UI
    updatePlayerLives(PlayerUI.lives, PlayerUI.maxLives);
    
    // console.log(`[CACHE] 💾 Récupération depuis le cache local: ${PlayerUI.lives} vies, ${PlayerUI.regenQueue.length} régénérations en attente`);
    return { lives: PlayerUI.lives, lastRegen: PlayerUI.lastRegen };
  }
};

// Player detection and initialization system
let playerDetectionInitialized = false;

export function initPlayerDetection() {
  if (playerDetectionInitialized) return;
  playerDetectionInitialized = true;

  let waitedTime = 0;
  let found = false;

  import('@dcl/sdk/ecs').then(({engine}) => {
    engine.addSystem((dt) => {
      if (found) return;
      waitedTime += dt;
      if (waitedTime > 1) { // 1 second
        const player = getPlayer();
        const playerName = player?.name ?? 'Player';
        const playerAddress = player && !player.isGuest ? player.userId : '';
        if (playerAddress) {
          // ✅ CORRECTION : Initialiser le joueur PUIS les diamants de manière séquentielle
          PlayerUI.init(CONFIG.PLAYER.LIVES, playerName, playerAddress).then(async () => {
            // Initialiser le système de mort APRÈS chargement Firebase pour éviter le son au reload
            const { initDeathSystem } = await import('./death');
            initDeathSystem();
            return initDiamondsForPlayer(playerName, playerAddress);
          }).catch(e => {
            console.error('[PLAYER] Error initializing:', e);
          });
          
          // Le joueur ne spawnera qu'après avoir cliqué sur START
          found = true;
        }
        waitedTime = 0;
      }
    });
  });

  
  // COMMANDES DE DEBUG GLOBALES
  (globalThis as any).debugRegen = () => {
    PlayerUI.forceRegen();
  };
  
  (globalThis as any).debugLoadCache = () => {
    PlayerUI.loadFromLocalCache();
  };
  
  (globalThis as any).debugStatus = () => {
  };
  
}

// Système de mise à jour de l'UI du joueur

let uiUpdateTimer = 0;
let playerSpawned = false;

// Fonction pour spawner le joueur (appelée depuis le bouton START)
export function spawnPlayer() {
  if (playerSpawned) return;
  
  
  const player = getPlayer();
  if (player) {
    // Calculer la hauteur du terrain au centre de la map
    const spawnX = 160;
    const spawnZ = 160;
    const terrainHeight = getTerrainHeight(spawnX, spawnZ);
    const spawnY = terrainHeight + 7.0; // 7 mètres au-dessus du terrain
    
    // Téléporter le joueur
    movePlayerTo({
      newRelativePosition: Vector3.create(spawnX, spawnY, spawnZ),
      cameraTarget: Vector3.create(spawnX, spawnY, spawnZ)
    });
    
    playerSpawned = true;
  }
}

// Exposer la fonction globalement pour le bouton START
(globalThis as any).spawnPlayer = spawnPlayer;

export function initPlayerUISystem() {
  engine.addSystem((dt: number) => {
    uiUpdateTimer += dt;
    
    // Mettre à jour l'UI toutes les 0.1 secondes
    if (uiUpdateTimer >= 0.1) {
      // Mettre à jour les vies
      updatePlayerLives(PlayerUI.lives, PlayerUI.maxLives);
      
      // Mettre à jour les diamants
      const diamonds = getDiamondsCollected();
      updatePlayerDiamonds(diamonds);
      
      // Debug: Log périodique pour vérifier la mise à jour - DÉSACTIVÉ
      // if (Math.floor(uiUpdateTimer * 10) % 100 === 0) { // Log toutes les 10 secondes (au lieu de 5)
      //   console.log(`[PLAYER_UI] Current diamonds: ${diamonds}`);
      // }
      
      // Mettre à jour le temps de récupération
      const nextRegen = PlayerUI.nextRegenIn();
      updateNextRegenTime(nextRegen);
      
      // Mettre à jour la stamina
      updatePlayerStamina(getStaminaPercentage());
      
      uiUpdateTimer = 0;
    }
  });
}