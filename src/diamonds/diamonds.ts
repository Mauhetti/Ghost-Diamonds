import { engine, Transform, MeshRenderer, Material, TextShape, Font, TextAlignMode, Billboard, BillboardMode, Entity, GltfContainer, VisibilityComponent, AvatarAttach } from '@dcl/sdk/ecs';
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math';
import { isInAnySafeZone } from '../components/safezones';
import { isPositionSafeFromTrees, findSafeSpawnPosition } from '../components/environment';
import { savePlayerDiamondsRobust, loadPlayerDiamondsRobust, verifyDiamondIntegrity } from './robust-diamond-persistence';
// import { setPlayerDiamonds } from './remote-diamonds'; // ANCIEN SYSTÈME DÉSACTIVÉ
import { updateLeaderboard } from '../components/leaderboard';
import { getPlayer } from '@dcl/sdk/players';
import { loadSharedSeed, randomRange, randomAngle } from '../utils/shared-seed';
// import { sendDiamondCarriedEvent, sendDiamondDroppedCollectedEvent, sendDiamondCollectEvent, cleanupOldEvents } from '../services/atomic-events'; // ANCIEN SYSTÈME DÉSACTIVÉ
import { createCarriedDiamond, attachDiamondToPlayer, isPlayerCarryingDiamond, syncCarryingState, getCarriedDiamond, getCarriedByPlayer } from './diamond-carrying';
import { checkSimpleDroppedCollection, collectSimpleDroppedDiamond, updateSimpleDroppedDiamonds, clearSimpleDroppedDiamonds, createSimpleDroppedDiamond, hasDroppedDiamondFor, removeDroppedDiamondFor, getSimpleDroppedCount } from './simple-dropped-diamonds';
import { isPlayerInvulnerable } from '../systems/death';
import { getTerrainHeight } from '../utils/terrain-height-loader';
import * as utils from '@dcl-sdk/utils';
import { 
  initDiamondStatesPersistence, 
  saveDiamondState, 
  loadPlayerDiamondStates, 
  getDiamondState, 
  getAllDiamondStates, 
  getDiamondCollectTimer, 
  stopDiamondCollectTimer,
  startDiamondStatesListening,
  setDiamondStatesUpdateCallback,
  reloadPlayerDiamondStates
} from './diamond-states-persistence';

// Diamond system configuration
const DIAMOND_CONFIG = {
  COUNT: 5, // Number of diamonds that spawn (simplified)
  SPAWN_INTERVAL: 300, // 5 minutes in seconds
  COLLECT_TIME: 300, // 5 minutes to collect before they disappear
  RESPAWN_TIME: 10, // 10 seconds to respawn after collection/disappearance
  DROPPED_TIME: 30, // 30 seconds for dropped diamonds
  SIZE: 0.5, // Diamond size
  EMERGE_HEIGHT: 1.5, // How high they emerge from ground
  GROUND_HEIGHT: 0.0, // Ground level (legacy, non utilisé)
  SPAWN_RADIUS: 150, // Radius around center for random spawn (covers whole scene)
  CENTER: { x: 160, y: 0, z: 160 }, // Center of the map
  MIN_DISTANCE: 50, // Minimum distance between diamonds
  // Timer text configuration
  TIMER: {
    BASE_FONT_SIZE: 4, // Taille de base plus grande
    MIN_SCALE: 0.8, // Scale minimum pour les distances proches
    MAX_SCALE: 4.0, // Scale maximum pour les distances lointaines
    REFERENCE_DISTANCE: 20, // Distance de référence pour le calcul du scale
    MAX_VISIBLE_DISTANCE: 200 // Distance maximale de visibilité
  }
};

// Diamond state
let diamonds: Entity[] = [];
let diamondTimerTexts: Entity[] = []; // Timer text entities above each diamond
let diamondDebugBars: Entity[] = []; // Debug bars verticales blanches au-dessus de chaque diamant
let diamondPositions: Vector3[] = [];
let diamondStates: ('emerging' | 'collectible' | 'disappearing' | 'hidden' | 'respawning' | 'carried')[] = [];
let diamondTimers: number[] = [];
let diamondCollectedBy: { [key: number]: string } = {}; // Track who collected each diamond

// Fonction pour nettoyer diamondCollectedBy après validation
export function clearDiamondCollectedBy(diamondIndex: number): void {
  delete diamondCollectedBy[diamondIndex];
  // console.log(`[DIAMONDS] Cleared diamondCollectedBy[${diamondIndex}]`); // Réduit les logs pour éviter 'Message too large'
}

let lastSpawnTime = Date.now() / 1000;
let isSpawning = false;
let playerDataLoaded = false; // Flag pour s'assurer que les données Firebase sont chargées

// Diamond persistence system
let diamondsCollected = 0;
let playerAddress = '';
let playerName = '';
let diamondsInitialized = false;
let initializationInProgress = false;

// Synchronisation
let lastSyncTime = 0;
let syncInterval = 3;
let lastIntegrityCheckTime = 0; // ✅ Timer pour limiter les vérifications d'intégrité
let justCollectedDropped = false; // Cooldown pour éviter les doublons de collecte
let lastUpdateTime = 0; // Pour throttling de updateDiamondNumbers


// Global state
declare global {
  var __DIAMONDS_SETUP__: boolean;
  var __DIAMONDS_SYSTEM__: boolean;
}

export function setupDiamonds() {
  if (globalThis.__DIAMONDS_SETUP__) return;
  globalThis.__DIAMONDS_SETUP__ = true;

  // Initialize diamond arrays first
  for (let i = 0; i < DIAMOND_CONFIG.COUNT; i++) {
    diamonds.push(engine.addEntity());
    diamondTimerTexts.push(engine.addEntity());
    diamondDebugBars.push(engine.addEntity());
    diamondPositions.push(Vector3.create(0, 0, 0));
    (diamondStates as any[]).push('hidden');
    diamondTimers.push(0);
  }

  // Create diamond entities (initially hidden)
  // Create a copy to avoid collection modification during enumeration
  const diamondsCopy = [...diamonds];
  diamondsCopy.forEach((diamond, i) => {
    Transform.create(diamond, {
      position: Vector3.create(0, DIAMOND_CONFIG.GROUND_HEIGHT, 0),
      scale: Vector3.create(DIAMOND_CONFIG.SIZE, DIAMOND_CONFIG.SIZE, DIAMOND_CONFIG.SIZE),
      rotation: Quaternion.Identity()
    });
    GltfContainer.create(diamond, { src: 'assets/scene/Models/diamond/diamond.glb' });
    VisibilityComponent.create(diamond, { visible: false }); // Initially hidden

    // Create timer text above each diamond
    const timerText = diamondTimerTexts[i];
    Transform.create(timerText, {
      position: Vector3.create(0, DIAMOND_CONFIG.GROUND_HEIGHT + 3, 0),
      scale: Vector3.create(1, 1, 1)
    });
    TextShape.create(timerText, {
      text: `#${i} - HIDDEN`,
      fontSize: DIAMOND_CONFIG.TIMER.BASE_FONT_SIZE, // Taille de base plus grande
      textColor: Color4.create(0.5, 0.5, 0.5, 0.5), // Gris transparent pour HIDDEN
      outlineColor: Color4.create(0, 0, 0, 1),
      outlineWidth: 0.1,
      textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
      font: Font.F_SANS_SERIF
    });
    Billboard.create(timerText, { billboardMode: BillboardMode.BM_Y });
    
    // Créer une barre blanche verticale pour debug
    const debugBar = diamondDebugBars[i];
    Transform.create(debugBar, {
      position: Vector3.create(0, DIAMOND_CONFIG.GROUND_HEIGHT + 2.5, 0), // Au-dessus du diamant
      scale: Vector3.create(0.2, 3, 0.2), // Barre fine et haute
      rotation: Quaternion.Identity()
    });
    MeshRenderer.setBox(debugBar); // Forme de box
    Material.setPbrMaterial(debugBar, {
      albedoColor: Color4.White(), // Blanc
      metallic: 0,
      roughness: 0.5,
      emissiveColor: Color4.create(1, 1, 1, 0.5), // Un peu de lumière pour la visibilité
      emissiveIntensity: 0.5
    });
    VisibilityComponent.create(debugBar, { visible: false }); // Initialement caché
  });
}

// Get current diamond count
export function getDiamondsCollected(): number {
  return diamondsCollected;
}

// Set diamond count (for UI updates)
export function setDiamondsCollected(count: number): void {
  diamondsCollected = count;
  
  // ✅ MISE À JOUR INSTANTANÉE DE L'UI
  if ((globalThis as any).updatePlayerDiamonds) {
    (globalThis as any).updatePlayerDiamonds(count);
    // console.log(`[DIAMONDS] ✅ UI updated instantly to ${count} diamonds`);
  }
  
  // ✅ VÉRIFICATION/CORRECTION : En arrière-plan (sans bloquer l'UI)
  if (playerAddress && playerName) {
    // Lancer la vérification en arrière-plan sans attendre
    verifyAndCorrectDiamondCount(count).catch((error) => {
      console.error('[DIAMONDS] ❌ Background verification failed:', error);
    });
  }
}

// ✅ FONCTION DE VÉRIFICATION/CORRECTION DES DIAMANTS
async function verifyAndCorrectDiamondCount(localCount: number) {
  try {
    // Charger le compte Firebase
    const firebaseCount = await loadPlayerDiamondsRobust(playerAddress);
    
    if (firebaseCount !== localCount) {
      // console.log(`[DIAMONDS] 🔄 Count mismatch detected: Local=${localCount}, Firebase=${firebaseCount}`);
      
      // Prendre la valeur la plus élevée (anti-cheat)
      const correctCount = Math.max(localCount, firebaseCount);
      
      if (correctCount !== localCount) {
        // console.log(`[DIAMONDS] 🔄 Correcting local count from ${localCount} to ${correctCount}`);
        diamondsCollected = correctCount;
        
        // Mettre à jour l'UI avec la valeur corrigée
        if ((globalThis as any).updatePlayerDiamonds) {
          (globalThis as any).updatePlayerDiamonds(correctCount);
        }
      }
      
      // Sauvegarder la valeur correcte dans Firebase (avec fallback direct)
      if (correctCount !== firebaseCount) {
        try {
          await savePlayerDiamondsRobust(playerAddress, playerName, correctCount);
          // console.log(`[DIAMONDS] 🔄 Saved corrected count ${correctCount} to Firebase`);
        } catch (error) {
          // console.log(`[DIAMONDS] ⚠️ Robust save failed, trying direct save...`);
          try {
            const { savePlayerDiamondsDirect } = await import('./robust-diamond-persistence');
            await savePlayerDiamondsDirect(playerAddress, playerName, correctCount);
            // console.log(`[DIAMONDS] ✅ Direct save successful: ${correctCount}`);
          } catch (directError) {
            console.error(`[DIAMONDS] ❌ Both robust and direct save failed:`, directError);
          }
        }
      }
    }
  } catch (error) {
    console.error('[DIAMONDS] ❌ Error during count verification:', error);
  }
}

// Initialize diamonds with robust persistence and states
export async function initDiamondsForPlayer(name: string, address: string) {
  
  if (diamondsInitialized) {
    return;
  }
  
  if (initializationInProgress) {
    return;
  }
  
  initializationInProgress = true;
  
  playerAddress = address;
  playerName = name;
  
  try {
    // Initialiser le système de persistance des états
    await initDiamondStatesPersistence(address);
    
    // Charger les états des diamants
    await loadPlayerDiamondStates();
    
    const recoveredDiamonds = await loadPlayerDiamondsRobust(address);
    // console.log(`[DIAMONDS] 🔥 SPAWN: Recovered ${recoveredDiamonds} diamonds from Firebase for ${name}`); // DÉSACTIVÉ pour réduire les logs
    
    // Toujours prendre la valeur la plus élevée
    if (recoveredDiamonds > diamondsCollected) {
      diamondsCollected = recoveredDiamonds;
      // console.log(`[DIAMONDS] 🔥 SPAWN: Updated from ${diamondsCollected} to ${recoveredDiamonds} diamonds`); // DÉSACTIVÉ pour réduire les logs
    } else if (diamondsCollected > recoveredDiamonds) {
      await savePlayerDiamondsRobust(address, name, diamondsCollected);
      // console.log(`[DIAMONDS] 🔥 SPAWN: Saved ${diamondsCollected} diamonds to Firebase`); // DÉSACTIVÉ pour réduire les logs
    }
    
    // ✅ TOUJOURS sauvegarder les diamants (même si 0) pour que le leaderboard fonctionne
    await savePlayerDiamondsRobust(address, name, diamondsCollected);
    // console.log(`[DIAMONDS] 🔥 SPAWN: Confirmed save of ${diamondsCollected} diamonds to /players/${address}/diamonds`); // DÉSACTIVÉ pour réduire les logs
    
    // Update leaderboard avec le bon nombre de diamants
    // console.log(`[DIAMONDS] 🔥 SPAWN: Player ${name} has ${diamondsCollected} diamonds from Firebase`); // DÉSACTIVÉ pour réduire les logs
    updateLeaderboard(name, diamondsCollected);
    // console.log(`[DIAMONDS] 🔥 SPAWN: Updated leaderboard with ${name}: ${diamondsCollected} diamonds`); // DÉSACTIVÉ pour réduire les logs
    
    // ✅ RAFRAÎCHISSEMENT FORCÉ du leaderboard au spawn pour que le joueur apparaisse immédiatement
    // console.log('[DIAMONDS] 🔥 SPAWN: Forcing leaderboard refresh for new player'); // DÉSACTIVÉ pour réduire les logs
    
    // ✅ IMMEDIATE: Refresh immédiat
    if ((globalThis as any).forceRefreshLeaderboard) {
      // console.log('[DIAMONDS] 🔥 SPAWN: Calling forceRefreshLeaderboard immediately'); // DÉSACTIVÉ pour réduire les logs
      (globalThis as any).forceRefreshLeaderboard();
    }
    
    // ✅ DELAYED: Refresh après un délai pour s'assurer que tout est synchronisé
    utils.timers.setTimeout(() => {
      if ((globalThis as any).forceRefreshLeaderboard) {
        // console.log('[DIAMONDS] 🔥 SPAWN: Calling forceRefreshLeaderboard after delay'); // DÉSACTIVÉ pour réduire les logs
        (globalThis as any).forceRefreshLeaderboard();
      } else {
        // console.log('[DIAMONDS] ⚠️ forceRefreshLeaderboard not available on globalThis');
      }
    }, 1000); // Attendre 1 seconde
    
    
  } catch (error) {
    console.error('[ROBUST_DIAMONDS] Error during initialization:', error);
    // En cas d'erreur, garder la valeur locale et essayer de sauvegarder
    if (diamondsCollected > 0) {
      await savePlayerDiamondsRobust(address, name, diamondsCollected);
    }
  } finally {
    // ✅ MARQUER QUE LES DONNÉES FIREBASE SONT CHARGÉES
    playerDataLoaded = true;
    // console.log(`[DIAMONDS] ✅ Player data loaded, ready to spawn diamonds with correct timers`);
    
    diamondsInitialized = true;
    initializationInProgress = false;
  }
}

// Generate deterministic spawn position avoiding safe zones and respecting minimum distance
function getDeterministicSpawnPosition(index: number, existingPositions: Vector3[], respawnCount: number = 0): Vector3 | null {
  const maxAttempts = 100; // Prevent infinite loop
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // ✅ ANTI-TRICHE : Utiliser l'index + le compteur de respawn pour avoir des positions différentes
    // La seed initiale est partagée, mais chaque respawn du même diamant a un offset différent
    const seedOffset = index * 1000 + respawnCount + attempt;
    const angle = randomAngle() + (seedOffset * 0.001); // Petit offset déterministe
    const distance = randomRange(0, DIAMOND_CONFIG.SPAWN_RADIUS);
    const candidateX = DIAMOND_CONFIG.CENTER.x + Math.cos(angle) * distance;
    const candidateZ = DIAMOND_CONFIG.CENTER.z + Math.sin(angle) * distance;
    
    // Obtenir la hauteur réelle du terrain à cette position
    const terrainHeight = getTerrainHeight(candidateX, candidateZ);
    
    const candidatePos = Vector3.create(
      candidateX,
      terrainHeight + 0.15, // Offset minimal pour que les diamants ne soient pas dans le sol
      candidateZ
    );
    
    // Check if position is in safe zone
    if (isInAnySafeZone(candidatePos.x, candidatePos.z)) {
      continue; // Try again
    }
    
    // Check if position is too close to trees (3 meter safety radius)
    if (!isPositionSafeFromTrees(candidatePos.x, candidatePos.z, 3)) {
      continue; // Try again
    }
    
    // Check minimum distance from existing diamonds
    let validDistance = true;
    for (const existingPos of existingPositions) {
      const dx = candidatePos.x - existingPos.x;
      const dz = candidatePos.z - existingPos.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < DIAMOND_CONFIG.MIN_DISTANCE) {
        validDistance = false;
        break;
      }
    }
    
    // Check distance from central safe zone
    const dxC = candidatePos.x - DIAMOND_CONFIG.CENTER.x;
    const dzC = candidatePos.z - DIAMOND_CONFIG.CENTER.z;
    const distToCenter = Math.sqrt(dxC * dxC + dzC * dzC);
    if (distToCenter < DIAMOND_CONFIG.MIN_DISTANCE) {
      validDistance = false;
    }
    
    if (validDistance) {
      return candidatePos;
    }
  }
  
  // If we couldn't find a valid position after max attempts, try to find a safe fallback
  
  // Try to find a safe position using the environment function
  const safePos = findSafeSpawnPosition(20, 3); // 20 attempts, 3 meter safety radius
  if (safePos) {
    const safePosHeight = getTerrainHeight(safePos.x, safePos.z);
    return Vector3.create(safePos.x, safePosHeight + 0.2, safePos.z);
  }
  
  // Last resort fallback (might be close to trees but better than nothing)
  const fallbackX = DIAMOND_CONFIG.CENTER.x + (randomRange(-100, 100));
  const fallbackZ = DIAMOND_CONFIG.CENTER.z + (randomRange(-100, 100));
  const fallbackHeight = getTerrainHeight(fallbackX, fallbackZ);
  
  return Vector3.create(
    fallbackX,
    fallbackHeight + 0.2,
    fallbackZ
  );
}

// Spawn diamonds (déterministe pour tous les joueurs)
function spawnDiamonds() {
  if (isSpawning) return;
  isSpawning = true;

  const existingPositions: Vector3[] = [];
  
  // Spawn process started
  
  // Create a copy to avoid collection modification during enumeration
  const diamondsCopy = [...diamonds];
  for (let i = 0; i < diamondsCopy.length; i++) {
    const diamond = diamondsCopy[i];
    
    // ✅ ANTI-TRICHE : Vérifier si le diamant existe dans Firebase
    const persistedState = getDiamondState(i);
    let spawnPos: Vector3;
    
    if (persistedState && persistedState.spawnPosition && 
        persistedState.spawnPosition.x !== 0 && persistedState.spawnPosition.z !== 0) {
      // Utiliser la position sauvegardée dans Firebase
      spawnPos = Vector3.create(
        persistedState.spawnPosition.x,
        persistedState.spawnPosition.y,
        persistedState.spawnPosition.z
      );
      
      // Restaurer l'état depuis Firebase
      const fbState = persistedState.state;
      if (fbState === 'emerging' || fbState === 'collectible' || fbState === 'disappearing' || 
          fbState === 'hidden' || fbState === 'respawning' || fbState === 'dropped') {
        (diamondStates as any[])[i] = fbState;
        
        // ✅ Calculer le temps écoulé depuis le dernier spawn
        const timeSinceSpawn = (Date.now() - (persistedState.spawnedAt || Date.now())) / 1000;
        
        // Calculer le timer restant en fonction de l'état
        if (fbState === 'collectible') {
          const COLLECT_TIME = 5 * 60; // 5 minutes en secondes
          const elapsedTime = Math.min(timeSinceSpawn, COLLECT_TIME);
          diamondTimers[i] = elapsedTime; // Timer = temps écoulé (pour affichage)
        } else if (fbState === 'emerging') {
          const EMERGE_TIME = 2; // 2 secondes
          const elapsedTime = Math.min(timeSinceSpawn, EMERGE_TIME);
          diamondTimers[i] = elapsedTime; // Timer = temps écoulé (pour affichage)
        } else if (fbState === 'disappearing') {
          const DISAPPEAR_TIME = 1; // 1 seconde
          const elapsedTime = Math.min(timeSinceSpawn, DISAPPEAR_TIME);
          diamondTimers[i] = elapsedTime; // Timer = temps écoulé (pour affichage)
        } else if (fbState === 'dropped') {
          // Si dropped, vérifier le timestamp de drop
          if (persistedState.droppedAt) {
            const timeSinceDrop = (Date.now() - persistedState.droppedAt) / 1000;
            const DROP_TIMER = 30; // 30 secondes
            const elapsedTime = Math.min(timeSinceDrop, DROP_TIMER);
            diamondTimers[i] = elapsedTime;
            
            // ✅ ANTI-TRICHE : Restaurer le dropped diamond visuel
            const dropPos = persistedState.dropPosition;
            if (dropPos && dropPos.x !== 0 && dropPos.z !== 0 && !hasDroppedDiamondFor(i)) {
              createSimpleDroppedDiamond(
                Vector3.create(dropPos.x, dropPos.y, dropPos.z),
                i
              );
              // console.log(`[DIAMONDS] Restored dropped diamond ${i} at position`, dropPos); // Réduit les logs pour éviter 'Message too large'
            }
          }
        } else {
          diamondTimers[i] = 0;
        }
        
        // console.log(`[DIAMONDS] Diamond ${i} restored from Firebase: state=${fbState}, timer=${diamondTimers[i].toFixed(1)}s`);
      } else {
        // État non géré, commencer par 'emerging'
        (diamondStates as any[])[i] = 'emerging';
        diamondTimers[i] = 0;
      }
    } else {
      // Nouveau diamant - générer une position déterministe
      const newSpawnPos = getDeterministicSpawnPosition(i, existingPositions, 0);
      if (!newSpawnPos) {
      console.error(`[DIAMONDS] Failed to find valid position for diamond ${i + 1}`);
        continue;
    }
      spawnPos = newSpawnPos;
    
    diamondPositions[i] = spawnPos;
    existingPositions.push(spawnPos);
      
      // Toujours commencer par 'emerging' pour un nouveau diamant
    (diamondStates as any[])[i] = 'emerging';
    diamondTimers[i] = 0;

      // ✅ NOUVELLE ARCHITECTURE : Sauvegarder seulement si le playerId est initialisé
      if (playerAddress) {
        saveDiamondState(i, 'emerging', {
          spawnPosition: spawnPos,
          spawnedAt: Date.now()
        }).catch(e => {
          console.error(`[DIAMONDS] Failed to save diamond ${i}:`, e);
        });
      } else {
        // console.log(`[DIAMONDS] Skipping Firebase save for diamond ${i} - player not initialized yet`);
      }
    }
    
    if (!diamondPositions[i] || diamondPositions[i].x === 0) {
      diamondPositions[i] = spawnPos;
      existingPositions.push(spawnPos);
    }


    // Position diamond at ground level initially (utiliser la hauteur du terrain)
    Transform.getMutable(diamond).position = Vector3.create(
      spawnPos.x,
      spawnPos.y, // spawnPos.y contient déjà la hauteur du terrain
      spawnPos.z
    );
    // Diamond positioned

    // Position timer text above diamond
    Transform.getMutable(diamondTimerTexts[i]).position = Vector3.create(
      spawnPos.x,
      spawnPos.y + 1.2, // spawnPos.y contient déjà la hauteur du terrain
      spawnPos.z
    );
    
    // Position debug bar above diamond
    Transform.getMutable(diamondDebugBars[i]).position = Vector3.create(
      spawnPos.x,
      spawnPos.y + 2.5, // spawnPos.y contient déjà la hauteur du terrain
      spawnPos.z
    );
  }

    // Spawn completed
  isSpawning = false;
  lastSpawnTime = Date.now() / 1000;
}

// Fonction pour respawner un diamant après collecte ou disparition
export function respawnDiamond(index: number) {
  // Starting respawn process
  
  // Marquer comme en cours de respawn
  (diamondStates as any[])[index] = 'respawning';
  
  // Attendre 10 secondes
  utils.timers.setTimeout(() => {
    // Générer une nouvelle position
    const existingPositions = diamondPositions.filter((pos, i) => 
      i !== index && (diamondStates as any[])[i] !== 'hidden' && (diamondStates as any[])[i] !== 'respawning'
    );
    

    // ✅ ANTI-TRICHE : Obtenir le compteur de respawn depuis Firebase ou utiliser 0
    const persistedState = getDiamondState(index);
    const respawnCount = persistedState ? ((persistedState as any).respawnCount || 0) + 1 : 0;
    
    const newPos = getDeterministicSpawnPosition(index, existingPositions, respawnCount);
    if (!newPos) {
      console.error(`[DIAMONDS] Failed to find respawn position for diamond ${index}`);
      return;
    }
    
    // ✅ NOUVELLE ARCHITECTURE : Sauvegarder seulement si le playerId est initialisé
    if (playerAddress) {
      saveDiamondState(index, 'emerging', {
        spawnPosition: newPos,
        spawnedAt: Date.now(),
        respawnCount: respawnCount
      } as any).catch(e => {
        console.error(`[DIAMONDS] Failed to save respawn for ${index}:`, e);
      });
    } else {
      // console.log(`[DIAMONDS] Skipping Firebase save for respawn ${index} - player not initialized yet`);
    }
    
    // Mettre à jour les positions locales
    diamondPositions[index] = newPos;
    (diamondStates as any[])[index] = 'emerging';
    diamondTimers[index] = 0;
    
    // Positionner le diamant
    Transform.getMutable(diamonds[index]).position = Vector3.create(
      newPos.x,
      newPos.y,
      newPos.z
    );
    
    // console.log(`[DIAMONDS] Diamond ${index} respawn completed with new position`); // Réduit les logs pour éviter 'Message too large'

  }, DIAMOND_CONFIG.RESPAWN_TIME * 1000);
}

// Mettre à jour l'affichage des numéros des diamants
function updateDiamondNumbers() {
  for (let i = 0; i < DIAMOND_CONFIG.COUNT; i++) {
    const timerText = diamondTimerTexts[i];
    const diamondEntity = diamonds[i];

    
    // ✅ MODE SOLO : Utiliser uniquement l'état LOCAL
    const localState = (diamondStates as any[])[i];
    let effectiveState = localState || 'hidden';

    
    // Gérer la visibilité du diamant
    if (diamondEntity) {
      const isVisible = effectiveState === 'emerging' || 
                       effectiveState === 'available' || 
                       effectiveState === 'collectible';
      
      if (VisibilityComponent.has(diamondEntity)) {
        const oldVisible = VisibilityComponent.get(diamondEntity).visible;
        VisibilityComponent.getMutable(diamondEntity).visible = isVisible;
        if (oldVisible !== isVisible) {

          // console.log(`[UPDATE_DIAMONDS] #${i}: Visibility changed: ${oldVisible} → ${isVisible}`); // Réduit les logs pour éviter 'Message too large'

        }
      } else if (isVisible) {
        VisibilityComponent.create(diamondEntity, { visible: true });
      }
      
      // Gérer la visibilité de la barre de debug (DÉSACTIVÉE - toujours invisible)
      const debugBar = diamondDebugBars[i];
      if (debugBar) {
        if (VisibilityComponent.has(debugBar)) {
          VisibilityComponent.getMutable(debugBar).visible = false; // Toujours invisible
        }
      }
      
      // Mettre à jour la position du texte pour suivre le diamant
      if (timerText && Transform.has(diamondEntity) && Transform.has(timerText)) {
        const diamondPos = Transform.get(diamondEntity).position;
        const timerTransform = Transform.getMutable(timerText);
        timerTransform.position = Vector3.create(
          diamondPos.x,
          diamondPos.y + 1.2,
          diamondPos.z
        );
      }
      
      // Mettre à jour la position de la barre de debug pour suivre le diamant
      if (debugBar && Transform.has(diamondEntity) && Transform.has(debugBar)) {
        const diamondPos = Transform.get(diamondEntity).position;
        const debugBarTransform = Transform.getMutable(debugBar);
        debugBarTransform.position = Vector3.create(
          diamondPos.x,
          diamondPos.y + 2.5,
          diamondPos.z
        );
      }
    }
    
    // ✅ Gérer les dropped diamonds pour la synchronisation multijoueur
    // Ne créer le dropped diamond QUE si l'état local n'est PAS dans un cycle de respawn
    // localState est déjà défini au début de la boucle
    const isInLocalRespawnCycle = localState === 'respawning' || 
                                 localState === 'hidden' || 
                                 localState === 'emerging' || 
                                 localState === 'disappearing' ||
                                 localState === 'available'; // Ajouter 'available' pour éviter la création pendant la transition
    

    // ❌ MODE SOLO : Pas de création automatique de dropped diamonds via updateDiamondNumbers
    // Les dropped diamonds sont gérés dans death.ts uniquement
    
    // ✅ Protéger les dropped diamonds : ne les supprimer que si l'état n'est plus 'dropped' ET que ce n'est pas dans la période initiale
    // Le dropped diamond est créé dans death.ts et doit rester jusqu'à ce que le timer expire dans la boucle principale
    if (hasDroppedDiamondFor(i)) {
      // Ne garder que si l'état est vraiment 'dropped' (et pas en train de transitionner)
      const shouldKeep = localState === 'dropped';
      
      // Logger pour debug
      if (!shouldKeep) {
        // console.log(`[UPDATE_DIAMONDS] #${i}: Removing dropped diamond because state changed from 'dropped' to '${localState}'`); // Réduit les logs pour éviter 'Message too large'
      }
      
      if (!shouldKeep) {
        removeDroppedDiamondFor(i);
      }

    }
    
    // Gérer la visibilité du timer
    // Utiliser l'état LOCAL pour déterminer la visibilité (pas Firebase)
    if (timerText) {
      // localState est déjà défini au début de la boucle
      const timerIsVisible = (localState === 'emerging' || 
                             localState === 'available' || 
                             localState === 'collectible' ||
                             localState === 'disappearing' ||
                             localState === 'dropped') && 
                             localState !== 'respawning';
      
      if (VisibilityComponent.has(timerText)) {
        VisibilityComponent.getMutable(timerText).visible = timerIsVisible;
      } else if (timerIsVisible) {
        VisibilityComponent.create(timerText, { visible: true });
      }
    }
    
    // Mettre à jour le texte (utiliser l'état LOCAL pour les états transitoires)
    if (timerText && TextShape.has(timerText)) {
      // localState et effectiveState sont déjà définis au début de la boucle
      
      const stateText = effectiveState === 'hidden' ? 'HIDDEN' : 
                       effectiveState === 'emerging' ? 'EMERGING' :
                       effectiveState === 'available' ? 'AVAILABLE' :
                       effectiveState === 'collectible' ? 'COLLECTIBLE' :
                       effectiveState === 'collected' ? 'COLLECTED' :
                       effectiveState === 'carried' ? 'CARRIED' :
                       effectiveState === 'disappearing' ? 'DISAPPEARING' :
                       effectiveState === 'respawning' ? 'RESPAWNING' :
                       effectiveState === 'dropped' ? 'DROPPED' : 'UNKNOWN';
      
      const displayText = `#${i} - ${stateText}`;
      const currentText = TextShape.get(timerText).text;
      if (currentText !== displayText) {

        // console.log(`[UPDATE_DIAMONDS] #${i}: Text changed: "${currentText}" → "${displayText}"`); // Réduit les logs pour éviter 'Message too large'

      }
      TextShape.getMutable(timerText).text = displayText;
      
      // Couleur selon l'état
      let newColor: Color4;
      if (effectiveState === 'hidden') {
        newColor = Color4.create(0.5, 0.5, 0.5, 0.5);
      } else if (effectiveState === 'collectible') {
        newColor = Color4.create(0.3, 0.7, 1.0, 1.0);
      } else if (effectiveState === 'available') {
        newColor = Color4.create(0.3, 0.7, 1.0, 1.0);
      } else if (effectiveState === 'collected' || effectiveState === 'carried') {
        newColor = Color4.create(1, 0, 0, 1);
      } else if (effectiveState === 'dropped') {
        newColor = Color4.create(1, 0, 0, 1);
      } else if (effectiveState === 'emerging') {
        newColor = Color4.create(1, 1, 0, 1);
      } else {
        newColor = Color4.create(1, 1, 1, 1);
      }
      TextShape.getMutable(timerText).textColor = newColor;
    }
  }
}

// Collect a diamond (événement atomique)
function collectDiamond(index: number) {
  // ✅ Récupérer l'ID du joueur actuel
  const currentPlayer = getPlayer();
  const playerId = currentPlayer?.userId || playerAddress;
  
  // Vérifier si le joueur porte déjà un diamant
  if (isPlayerCarryingDiamond(playerId)) {
    return;
  }
  

  // ✅ Supprimer le dropped diamond s'il existe pour cet index
  if (hasDroppedDiamondFor(index)) {
    // console.log(`[DIAMONDS] Removing dropped diamond for index ${index} before normal collection`); // Réduit les logs pour éviter 'Message too large'
    removeDroppedDiamondFor(index);
  }
  
  // ✅ Vérifier que le diamant n'est pas déjà porté
  if ((diamondStates as any[])[index] === 'carried') {
    // console.log(`[DIAMONDS] Diamond ${index} is already carried, skipping collection`); // Réduit les logs pour éviter 'Message too large'
    return;
  }
  
  // ✅ FORCER l'état à 'carried' immédiatement pour éviter les doublons
  (diamondStates as any[])[index] = 'carried';
  

  // Créer un diamant porté
  const carriedDiamond = createCarriedDiamond();
  
  // Attacher le diamant à la main droite du joueur
  const attached = attachDiamondToPlayer(carriedDiamond, playerId);
  if (!attached) {
    console.error(`[DIAMONDS] Failed to attach diamond ${index} to player ${playerId}`);
    // Nettoyer les matériaux avant suppression
    if (Material.has(carriedDiamond)) {
      Material.deleteFrom(carriedDiamond);
    }
    engine.removeEntity(carriedDiamond);

    // Revenir à l'état précédent
    (diamondStates as any[])[index] = 'collectible';

    return;
  }
  
  // Mettre à jour playerAddress si nécessaire
  if (currentPlayer?.userId && !playerAddress) {
    playerAddress = currentPlayer.userId;
  }
  

  // ✅ ANTI-TRICHE : Sauvegarder la collecte dans Firebase

  saveDiamondState(index, 'carried', {
    collectedBy: playerId,
    collectedAt: Date.now()
  }).catch(e => {

    console.error(`[DIAMONDS] Failed to save collection for ${index}:`, e);

  });
  
  // Marquer le diamant original comme collecté localement
  diamondCollectedBy[index] = playerId;
  
  // Envoyer l'événement atomique pour la synchronisation - DÉSACTIVÉ EN MODE SOLO
  // sendDiamondCollectEvent(index, playerId, playerName).then(() => {
  // }).catch(e => {
  //   console.error('[ATOMIC_EVENTS] ❌ Error sending collect event:', e);
  // });
  

  // Mettre à jour la position du diamant original
  Transform.getMutable(diamonds[index]).position = Vector3.create(
    diamondPositions[index].x,
    diamondPositions[index].y - 1, // Utiliser la hauteur du terrain
    diamondPositions[index].z
  );
  
  // NE PAS démarrer le respawn ici - il sera géré par la validation ou la mort
  // Le respawn sera déclenché quand le diamant sera validé ou quand le joueur mourra
  
  // Envoyer l'événement de portage de diamant - DÉSACTIVÉ EN MODE SOLO
  // sendDiamondCarriedEvent(playerId, playerName, true);
}

// Check if player is near a diamond for collection
function checkDiamondCollection(playerPos: Vector3): number | null {
  const collectionDistance = 2.0; // Distance to collect diamond

  // Vérifier si le joueur porte déjà un diamant
  if (isPlayerCarryingDiamond(playerAddress)) {
    // console.log(`[DIAMONDS] 🔍 DEBUG: Player already carrying diamond, skipping collection`);
    return null;
  }

  for (let i = 0; i < diamonds.length; i++) {
    // ✅ MODE SOLO : Chaque joueur peut collecter indépendamment
    // Skip if not collectible (diamondCollectedBy check removed for solo mode)
    if ((diamondStates as any[])[i] !== 'collectible') continue;

    const diamondPos = Transform.get(diamonds[i]).position;
    const dx = playerPos.x - diamondPos.x;
    const dz = playerPos.z - diamondPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance < collectionDistance) {
      return i;
    }
  }
  return null;
}

// Diamond system (déterministe sans leader)
export function createDiamondSystem() {
  if (globalThis.__DIAMONDS_SYSTEM__) return;
  globalThis.__DIAMONDS_SYSTEM__ = true;

  // ✅ Initialiser le son de collecte
  import('./diamond-carrying').then(({ initCollectSound }) => {
    initCollectSound();
  });

  // Initialize diamonds first if not already done
  if (diamonds.length === 0) {
    // console.log('[DIAMONDS] Initializing diamond entities...'); // Réduit les logs pour éviter 'Message too large'
    for (let i = 0; i < DIAMOND_CONFIG.COUNT; i++) {
      diamonds.push(engine.addEntity());
      diamondTimerTexts.push(engine.addEntity());
      diamondPositions.push(Vector3.create(0, 0, 0));
      (diamondStates as any[]).push('hidden');
      diamondTimers.push(0);
    }
    
    // Create diamond entities (initially hidden)
    diamonds.forEach((diamond, i) => {
      Transform.create(diamond, {
        position: Vector3.create(0, DIAMOND_CONFIG.GROUND_HEIGHT, 0),
        scale: Vector3.create(DIAMOND_CONFIG.SIZE, DIAMOND_CONFIG.SIZE, DIAMOND_CONFIG.SIZE),
        rotation: Quaternion.Identity()
      });
      GltfContainer.create(diamond, { src: 'assets/scene/Models/diamond/diamond.glb' });
      VisibilityComponent.create(diamond, { visible: false }); // Initially hidden

      // Create timer text above each diamond
      const timerText = diamondTimerTexts[i];
      Transform.create(timerText, {
        position: Vector3.create(0, DIAMOND_CONFIG.GROUND_HEIGHT + 3, 0),
        scale: Vector3.create(1, 1, 1)
      });
      TextShape.create(timerText, {
        text: '',
        fontSize: DIAMOND_CONFIG.TIMER.BASE_FONT_SIZE, // Taille de base plus grande
        textColor: Color4.create(1, 1, 1, 1),
        textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
        outlineColor: Color4.create(0, 0, 0, 1),
        outlineWidth: 0.1,
        font: Font.F_SANS_SERIF
      });
      Billboard.create(timerText, { billboardMode: BillboardMode.BM_Y });
    });
    // console.log(`[DIAMONDS] Created ${diamonds.length} diamond entities`);
  }


  // Load shared seed first
  loadSharedSeed().then(async () => {
    // ✅ ANTI-TRICHE : Charger les timestamps depuis Firebase pour le joueur actuel
    if (playerAddress) {
      await initDiamondStatesPersistence(playerAddress);
    }
    
    // ✅ ATTENDRE QUE LES DONNÉES DU JOUEUR SOIENT CHARGÉES
    // console.log('[DIAMONDS] ⏳ Waiting for player data to load...');
    await new Promise(resolve => utils.timers.setTimeout(() => resolve(undefined), 3000));
    
    // Initialiser le système simple de dropped diamonds
    clearSimpleDroppedDiamonds();
    // ✅ ANTI-TRICHE : Spawner les diamants en restaurant les états depuis Firebase
    spawnDiamonds();
    lastSpawnTime = Date.now() / 1000;
    // console.log('[DIAMONDS] ✅ Initial spawn completed with Firebase timers');
  });

  engine.addSystem((dt) => {
    try {
      const currentTime = Date.now() / 1000;
      const player = engine.PlayerEntity;
      
      if (!Transform.has(player)) return;
      const playerPos = Transform.get(player).position;
      
      // Synchroniser l'état des diamants locaux seulement (Firebase est géré par le listening)
      syncDiamondState();
      
      // Mettre à jour l'affichage des numéros des diamants UNIQUEMENT si on n'a pas mis à jour récemment
      // (réduit les messages CRDT pour éviter "Message too large")
      if (!lastUpdateTime || currentTime - lastUpdateTime > 1.0) { // Throttle à 1 fois par seconde max (réduit de 0.2 à 1.0)
        updateDiamondNumbers();
        lastUpdateTime = currentTime;
      }
      
      // Verify diamond integrity every 30 seconds (au lieu de chaque frame)
      if (playerAddress && playerName && diamondsInitialized && (!lastIntegrityCheckTime || currentTime - lastIntegrityCheckTime > 30.0)) {
        lastIntegrityCheckTime = currentTime;
        verifyDiamondIntegrity(playerAddress, playerName, diamondsCollected).then(verifiedCount => {
          if (verifiedCount !== diamondsCollected) {
            diamondsCollected = verifiedCount;
            updateLeaderboard(playerName, diamondsCollected);
            // console.log(`[ROBUST_DIAMONDS] Integrity check: corrected diamonds from ${diamondsCollected} to ${verifiedCount}`);
          }
        }).catch(e => {
          console.error('[ROBUST_DIAMONDS] Integrity check failed:', e);
        });
      }
    
    // Load and process atomic events - DÉSACTIVÉ EN MODE SOLO
    // Tout le système d'événements atomiques a été supprimé car inutile en mode solo
      
    // Cleanup old events periodically - DÉSACTIVÉ EN MODE SOLO
    // if (Math.random() < 0.1) { // 10% chance
    //   cleanupOldEvents();
    // }
    
    lastSyncTime = currentTime;

    // Spawn new diamonds seulement si aucun n'existe dans Firebase
    // Ne PAS re-spawner automatiquement toutes les 5 minutes
    if (currentTime - lastSpawnTime >= DIAMOND_CONFIG.SPAWN_INTERVAL) {
      const hasAnyDiamond = Object.keys(getAllDiamondStates()).length > 0;
      
      if (!hasAnyDiamond) {
        // console.log('[DIAMONDS] No diamonds in Firebase, spawning initial diamonds...'); // Réduit les logs pour éviter 'Message too large'
      spawnDiamonds();
      } else {
        // Les diamants existent déjà, juste vérifier qu'ils sont bien positionnés
        // console.log('[DIAMONDS] Diamonds already exist in Firebase, skipping spawn'); // Réduit les logs pour éviter 'Message too large'
        lastSpawnTime = currentTime; // Reset timer pour éviter la boucle
      }
    }

    // ✅ MODE SOLO : Pas de synchronisation Firebase pour les diamants
    // Les états sont purement locaux
    for (let i = 0; i < diamonds.length; i++) {
      
      const state = (diamondStates as any[])[i];
      
      switch (state) {
        case 'emerging':
          // Animation d'émergence (2 secondes)
          diamondTimers[i] += dt;
          if (diamondTimers[i] >= 2) {
            (diamondStates as any[])[i] = 'collectible';
            diamondTimers[i] = 0;
            // ✅ NOUVELLE ARCHITECTURE : Sauvegarder seulement si le playerId est initialisé
            if (playerAddress) {
              saveDiamondState(i, 'collectible', {
                spawnedAt: Date.now() // Mettre à jour le timestamp
              }).catch(e => {
                console.error(`[DIAMONDS] Failed to save collectible transition for ${i}:`, e);
              });
            }
          }
          break;
          
        case 'collectible':
          // ✅ MODE SOLO : Timer local (5 minutes)
          diamondTimers[i] += dt;
          
          if (diamondTimers[i] >= DIAMOND_CONFIG.COLLECT_TIME) {
            // Le diamant disparaît - démarrer le respawn
            (diamondStates as any[])[i] = 'disappearing';
            diamondTimers[i] = 0;
            
            // ✅ NOUVELLE ARCHITECTURE : Sauvegarder seulement si le playerId est initialisé
            if (playerAddress) {
              saveDiamondState(i, 'disappearing', {
                spawnedAt: Date.now() // Mettre à jour le timestamp
              }).catch(e => {
                console.error(`[DIAMONDS] Failed to save disappearing transition for ${i}:`, e);
              });
            }
            
            // Démarrer le processus de respawn
            respawnDiamond(i);
          }
          break;
          
        case 'disappearing':
          // Animation de disparition (1 seconde)
          diamondTimers[i] += dt;
          if (diamondTimers[i] >= 1) {
            (diamondStates as any[])[i] = 'hidden';
            diamondTimers[i] = 0;
            // Le respawn est déjà en cours via respawnDiamond()
          }
          break;
          
        case 'respawning':
          // En cours de respawn - cacher le diamant et attendre avant de spawner
          diamondTimers[i] += dt;
          const respawnDelay = 10; // 10 secondes avant respawn
          
          if (diamondTimers[i] >= respawnDelay) {
            // Timer écoulé - démarrer le respawn
            (diamondStates as any[])[i] = 'hidden';
            diamondTimers[i] = 0;
          }
          break;
          
        case 'carried':
          // Diamant porté - timer en pause
          break;
          
        case 'dropped':
          // ✅ ANTI-TRICHE : Gérer le timer de dropped dans la boucle principale
          // Le timer est initialisé depuis Firebase au spawn
          if (diamondTimers[i] === undefined || diamondTimers[i] > 30) {
            diamondTimers[i] = 0;
          }
          
          // Gérer le timer de respawn (30 secondes)
          diamondTimers[i] += dt;
          const droppedTimerSeconds = 30;
          const droppedRemaining = droppedTimerSeconds - diamondTimers[i];
          
          if (droppedRemaining <= 0) {
            // Timer écoulé - passer à respawning et nettoyer le dropped diamond
            // console.log(`[DIAMONDS] Dropped timer expired for diamond ${i}, switching to respawning...`); // Réduit les logs pour éviter 'Message too large'
            
            // Nettoyer le dropped diamond s'il existe
            if (hasDroppedDiamondFor(i)) {
              removeDroppedDiamondFor(i);
            }
            
            // Passer à respawning localement
            (diamondStates as any[])[i] = 'respawning';
            diamondTimers[i] = 0;
            
            // ✅ NOUVELLE ARCHITECTURE : Sauvegarder seulement si le playerId est initialisé
            if (playerAddress) {
              saveDiamondState(i, 'respawning', {
                spawnedAt: Date.now()
              } as any).catch(e => {
                console.error(`[DIAMONDS] Failed to save respawning transition for ${i}:`, e);
              });
            }
          }
          break;
          
        case 'hidden':
          // Diamant caché - ne rien faire
          break;
      }
    }

    // Update each diamond (déterministe pour tous les joueurs)
    // Create a copy to avoid collection modification during enumeration
    const diamondsCopy = [...diamonds];
    for (let i = 0; i < diamondsCopy.length; i++) {
      const diamond = diamondsCopy[i];
      const transform = Transform.getMutable(diamond);
      const currentPos = transform.position;
      const timerText = diamondTimerTexts[i];
      const timerTransform = Transform.getMutable(timerText);
      
      // Update timer text position to follow diamond
      timerTransform.position = Vector3.create(
        currentPos.x,
        currentPos.y + 1.2,
        currentPos.z
      );

      // Calculate distance to player for dynamic text scaling
      const player = engine.PlayerEntity;
      if (Transform.has(player)) {
        const playerPos = Transform.get(player).position;
        const dx = currentPos.x - playerPos.x;
        const dz = currentPos.z - playerPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Scale text based on distance for better visibility
        let scale = 1.0;
        
        if (distance <= DIAMOND_CONFIG.TIMER.REFERENCE_DISTANCE) {
          // Distance proche : scale minimum pour éviter que ce soit trop gros
          scale = DIAMOND_CONFIG.TIMER.MIN_SCALE;
        } else if (distance <= DIAMOND_CONFIG.TIMER.MAX_VISIBLE_DISTANCE) {
          // Distance moyenne à lointaine : scale progressif pour maintenir la visibilité
          const progress = (distance - DIAMOND_CONFIG.TIMER.REFERENCE_DISTANCE) / 
                          (DIAMOND_CONFIG.TIMER.MAX_VISIBLE_DISTANCE - DIAMOND_CONFIG.TIMER.REFERENCE_DISTANCE);
          scale = DIAMOND_CONFIG.TIMER.MIN_SCALE + 
                  (DIAMOND_CONFIG.TIMER.MAX_SCALE - DIAMOND_CONFIG.TIMER.MIN_SCALE) * progress;
        } else {
          // Distance très lointaine : scale maximum
          scale = DIAMOND_CONFIG.TIMER.MAX_SCALE;
        }
        
        timerTransform.scale = Vector3.create(scale, scale, scale);
      }

      // Nouveau système d'affichage simplifié
      const state = (diamondStates as any[])[i];
      
      // Debug log supprimé pour éviter les messages trop volumineux
      
      switch (state) {
        case 'emerging':
          // Animation d'émergence
          const emergeProgress = Math.min(diamondTimers[i] / 2.0, 1.0);
          const targetY = diamondPositions[i].y + (DIAMOND_CONFIG.EMERGE_HEIGHT * emergeProgress);
          
          transform.position = Vector3.create(
            diamondPositions[i].x,
            targetY,
            diamondPositions[i].z
          );
          TextShape.getMutable(timerText).text = '💎 EMERGING';
          TextShape.getMutable(timerText).textColor = Color4.create(1, 1, 0, 1); // Jaune
          break;

        case 'collectible':
          // ✅ FORCER LA POSITION CORRECTE du diamant (au cas où elle a été modifiée)
          // L'animation emerging s'anime vers diamondPositions[i].y + EMERGE_HEIGHT (1.5m)
          // Donc les diamants collectible doivent être à cette hauteur
          const collectibleY = diamondPositions[i].y + DIAMOND_CONFIG.EMERGE_HEIGHT;
          transform.position = Vector3.create(
            diamondPositions[i].x,
            collectibleY,
            diamondPositions[i].z
          );
          
          // ✅ MODE SOLO : Afficher le temps restant avec le timer local
          const remainingTime = DIAMOND_CONFIG.COLLECT_TIME - diamondTimers[i];
          const minutes = Math.floor(remainingTime / 60);
          const seconds = Math.floor(remainingTime % 60);
          TextShape.getMutable(timerText).text = `💎 ${minutes}:${seconds.toString().padStart(2, '0')}`;
          TextShape.getMutable(timerText).textColor = Color4.create(0.3, 0.7, 1.0, 1.0); // Bleu clair
          
          // Vérifier la collecte (sauf si on vient de collecter un dropped diamond)
          if (!justCollectedDropped) {
          const collectedIndex = checkDiamondCollection(playerPos);
          if (collectedIndex === i) {
            collectDiamond(i);
            }
          }
          break;

        case 'disappearing':
          // Animation de disparition
          const disappearProgress = Math.min(diamondTimers[i] / 1.0, 1.0);
          const disappearY = diamondPositions[i].y + (DIAMOND_CONFIG.EMERGE_HEIGHT * (1 - disappearProgress));
          
          transform.position = Vector3.create(
            diamondPositions[i].x,
            disappearY,
            diamondPositions[i].z
          );
          TextShape.getMutable(timerText).text = '💎 DISAPPEARING';
          TextShape.getMutable(timerText).textColor = Color4.create(1, 1, 1, 1); // Blanc
          break;

        case 'respawning':
          // En cours de respawn - cacher le diamant et afficher le countdown
          transform.position = Vector3.create(
            diamondPositions[i].x,
            diamondPositions[i].y - 1,
            diamondPositions[i].z
          );
          
          // Afficher le countdown du respawn
          const respawnDelay = 10; // 10 secondes
          const respawnRemaining = respawnDelay - diamondTimers[i];
          const respawnMin = Math.floor(respawnRemaining / 60);
          const respawnSec = Math.floor(respawnRemaining % 60);
          TextShape.getMutable(timerText).text = `💎 RESPAWNING ${respawnMin}:${respawnSec.toString().padStart(2, '0')}`;
          TextShape.getMutable(timerText).textColor = Color4.create(1, 1, 1, 1); // Blanc
          break;

        case 'carried':
          // Diamant porté - cacher le diamant original
          transform.position = Vector3.create(
            diamondPositions[i].x,
            diamondPositions[i].y - 1,
            diamondPositions[i].z
          );
          TextShape.getMutable(timerText).text = '';
          break;

        case 'dropped':

          // ✅ Initialiser le timer si c'est la première fois qu'on entre dans cet état
          // Le timer est initialisé à 0 quand on force l'état, mais au cas où on y revient
          if (diamondTimers[i] === undefined || diamondTimers[i] > 30) {
            diamondTimers[i] = 0;
          }
          
          // ✅ CACHER LE DIAMANT ORIGINAL SOUS LE SOL PENDANT L'ÉTAT DROPPED (rendu invisible)
          transform.position = Vector3.create(
            diamondPositions[i].x,
            diamondPositions[i].y - 1,
            diamondPositions[i].z
          );

          // Diamant tombé - gérer le timer de respawn (30 secondes)
          diamondTimers[i] += dt;
          const droppedTimerSeconds = 30; // 30 secondes
          const droppedRemaining = droppedTimerSeconds - diamondTimers[i];
          
          if (droppedRemaining > 0) {
            const minutes = Math.floor(droppedRemaining / 60);
            const seconds = Math.floor(droppedRemaining % 60);
            TextShape.getMutable(timerText).text = `💎 DROPPED ${minutes}:${seconds.toString().padStart(2, '0')}`;
          } else {
            // Timer écoulé - passer à respawning et nettoyer le dropped diamond

            // console.log(`[DIAMONDS] Dropped timer expired for diamond ${i}, switching to respawning...`); // Réduit les logs pour éviter 'Message too large'
            TextShape.getMutable(timerText).text = '💎 RESPawning';
            
            // Nettoyer le dropped diamond s'il existe
            if (hasDroppedDiamondFor(i)) {
              removeDroppedDiamondFor(i);
            }
            
            // ✅ 'respawning' est un état local uniquement
            // Ne PAS le sauvegarder dans Firebase pour éviter les conflits de synchronisation
            // Firebase reste sur 'dropped' temporairement, mais il sera ignoré par la synchronisation
            // car le diamant est maintenant en état local transitoire
            
            // Passer à respawning localement
            (diamondStates as any[])[i] = 'respawning';
            
            // Reset le timer
            diamondTimers[i] = 0;
          }
          break;

        case 'available':
          // Diamant disponible (après validation) - commencer immédiatement l'émergence
          transform.position = Vector3.create(
            diamondPositions[i].x,
            diamondPositions[i].y - 1,
            diamondPositions[i].z
          );
          TextShape.getMutable(timerText).text = '';
          
          // Passer immédiatement à emerging
          (diamondStates as any[])[i] = 'emerging';
          diamondTimers[i] = 0;
          break;

        case 'hidden':
          // Diamant caché - vérifier s'il doit émerger
          transform.position = Vector3.create(
            diamondPositions[i].x,
            diamondPositions[i].y - 1,
            diamondPositions[i].z
          );
          TextShape.getMutable(timerText).text = '';
          
          // Faire émerger le diamant après 5 secondes
          diamondTimers[i] += dt;
          if (diamondTimers[i] >= 5) {
            (diamondStates as any[])[i] = 'emerging';
            diamondTimers[i] = 0;
          }
          break;
        }
      }
      
    // Check for dropped diamond collection (OUTSIDE the main diamond loop)
    // NE PAS collecter si le joueur vient de mourir (période de grâce)
    const droppedIndex = checkSimpleDroppedCollection(playerPos);
    if (droppedIndex !== null && !isPlayerInvulnerable()) {
      
      // ✅ Vérifier si le joueur ne porte PAS déjà un diamant
      if (isPlayerCarryingDiamond(playerAddress)) {
        // console.log('[DIAMONDS] Player already carrying a diamond, skipping dropped collection'); // Réduit les logs pour éviter 'Message too large'
        return;
      }
        
        // Envoyer l'événement de collecte de diamant tombé - DÉSACTIVÉ EN MODE SOLO
        // sendDiamondDroppedCollectedEvent(droppedIndex, playerAddress, playerName);
      // ✅ Activer le cooldown pour éviter la collecte dans la boucle
      justCollectedDropped = true;
      
      // Collecter le diamant tombé
      const result = collectSimpleDroppedDiamond(droppedIndex);
      if (result) {
        // Supprimer l'entité dropped (elle a fait son travail)
        engine.removeEntity(result.entity);
        
        // ✅ Forcer l'état local du diamant original à 'carried'
        forceSetDiamondState(result.diamondIndex, 'carried');
        
        // Créer un diamant porté
        // ATTENTION: attachDiamondToPlayer() vérifie déjà si on porte un diamant
        const carriedDiamond = createCarriedDiamond();
        if (!attachDiamondToPlayer(carriedDiamond, playerAddress)) {
          // L'échec signifie qu'on porte déjà un diamant - supprimer l'entité créée
          // console.log('[DIAMONDS] Failed to attach - already carrying, removing entity'); // Réduit les logs pour éviter 'Message too large'
          engine.removeEntity(carriedDiamond);
        }
      }
    }
    
    // Update simple dropped diamonds
    updateSimpleDroppedDiamonds(dt);
    
    // ✅ Désactiver le cooldown à la fin de chaque frame
    if (justCollectedDropped) {
      justCollectedDropped = false;
    }
    } catch (error) {
      console.error('[DIAMONDS_SYSTEM] ❌ Error in diamond system:', error);
      if (error instanceof Error) {
        console.error('[DIAMONDS_SYSTEM] ❌ Error stack:', error.stack);
      }
    }
  });
}

// Reset diamonds count (useful for testing or global reset)
export async function resetDiamondsCollected(): Promise<void> {
  diamondsCollected = 0;
  // await setPlayerDiamonds(playerAddress, playerName, 0); // ANCIEN SYSTÈME DÉSACTIVÉ
  // Utilise le nouveau système player-isolé via robust-diamond-persistence
  if (playerAddress) {
    await savePlayerDiamondsRobust(playerAddress, playerName, 0);
  }
}

// Synchroniser l'état des diamants entre joueurs
export function syncDiamondState() {
  // ✅ ANTI-TRICHE : Ne PAS synchroniser si l'état local est 'dropped'
  // Car 'dropped' est une transition suite à la mort du joueur
  // et doit être maintenu jusqu'à expiration du timer
  
  // Synchroniser les diamants collectés
  for (let i = 0; i < diamonds.length; i++) {
    const localState = (diamondStates as any[])[i];
    
    // Ne PAS toucher aux diamants en état 'dropped'
    if (localState === 'dropped') {
      continue; // Garder l'état 'dropped'
    }
    
    if (diamondCollectedBy[i]) {
      // Vérifier d'abord si Firebase a un état différent (source de vérité)
      const persistedState = getDiamondState(i);
      if (persistedState && persistedState.state !== 'carried' && persistedState.state !== 'dropped') {
        // Firebase dit que ce n'est pas 'carried' ou 'dropped', nettoyer diamondCollectedBy
        // console.log(`[SYNC_STATE] Diamond ${i} is ${persistedState.state} in Firebase, clearing diamondCollectedBy`); // Réduit les logs pour éviter "Message too large"
        diamondCollectedBy[i] = '';
      } else if (localState === 'carried') {
        // Le diamant a été collecté, le marquer comme porté
        Transform.getMutable(diamonds[i]).position = Vector3.create(
          diamondPositions[i].x,
          diamondPositions[i].y - 1,
          diamondPositions[i].z
        );
      }
    }
  }
}

// Expose diamond entities for multiplayer synchronization
export function getDiamondEntities(): Entity[] {
  return diamonds;
}

// Obtenir les états des diamants depuis Firebase
export function getDiamondStates(): ('emerging' | 'collectible' | 'disappearing' | 'hidden' | 'respawning' | 'carried')[] {
  const states: ('emerging' | 'collectible' | 'disappearing' | 'hidden' | 'respawning' | 'carried')[] = [];
  
  for (let i = 0; i < DIAMOND_CONFIG.COUNT; i++) {
    const persistedState = getDiamondState(i);
    const state = persistedState ? persistedState.state : 'hidden';
    states.push(state as any);
  }
  
  return states;
}

// Forcer l'état d'un diamant (utilisé pour éviter les conflits de synchronisation)
export function forceSetDiamondState(diamondIndex: number, state: 'emerging' | 'collectible' | 'disappearing' | 'hidden' | 'respawning' | 'carried' | 'dropped' | 'available' | 'collected'): void {
  if (diamondIndex >= 0 && diamondIndex < diamonds.length) {
    (diamondStates as any[])[diamondIndex] = state;
    diamondTimers[diamondIndex] = 0; // Reset le timer
    // console.log(`[DIAMONDS] Force set diamond ${diamondIndex} to state: ${state}`); // Réduit les logs pour éviter 'Message too large'
  }
}

// Fonction de diagnostic pour vérifier l'état complet du système de diamants
export function diagnoseDiamondSystem() {
  console.log('[DIAMONDS] 🔍 DIAMOND SYSTEM DIAGNOSIS:');
  
  const player = getPlayer();
  if (!player) {
    console.log('  ❌ No player found');
    return;
  }
  
  console.log(`  - Player: ${player.name} (${player.userId})`);
  console.log(`  - Local diamond count: ${getDiamondsCollected()}`);
  console.log(`  - Carried diamond: ${getCarriedDiamond()}`);
  console.log(`  - Carried by player: ${getCarriedByPlayer()}`);
  
  // Vérifier les entités avec AvatarAttach
  let avatarAttachCount = 0;
  for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
    if (GltfContainer.has(entity)) {
      const gltf = GltfContainer.get(entity);
      if (gltf.src.includes('diamond.glb')) {
        avatarAttachCount++;
        console.log(`  - AvatarAttach diamond entity: ${entity}`);
      }
    }
  }
  
  console.log(`  - AvatarAttach diamond count: ${avatarAttachCount}`);
  
  // Vérifier les entités GltfContainer diamond
  let gltfDiamondCount = 0;
  for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
    const gltf = GltfContainer.get(entity);
    if (gltf.src.includes('diamond.glb')) {
      gltfDiamondCount++;
      console.log(`  - GltfContainer diamond entity: ${entity} (AvatarAttach: ${AvatarAttach.has(entity)})`);
    }
  }
  
  console.log(`  - GltfContainer diamond count: ${gltfDiamondCount}`);
  
  // Diagnostic
  if (avatarAttachCount === 0 && getCarriedDiamond() === null) {
    console.log('  ✅ System appears healthy - no stuck diamonds');
  } else {
    console.log('  ⚠️ System may have issues - consider running resetDiamondCollectionSystem()');
  }
}

// Exposer la fonction de diagnostic globalement
(globalThis as any).diagnoseDiamondSystem = diagnoseDiamondSystem;