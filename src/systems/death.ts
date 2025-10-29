// ============================================================================
// DEATH SYSTEM
// ============================================================================
// Système centralisé pour gérer la mort des joueurs dans la scène VIBE
// Gère : mort par fantôme → détachement des diamants → respawn → invulnérabilité
// ============================================================================


import { engine, Transform, InputModifier, AvatarAttach, AudioSource, Entity, GltfContainer } from '@dcl/sdk/ecs';
import { Vector3 } from '@dcl/sdk/math';
import { PlayerUI } from './player';
import { getPlayer } from '@dcl/sdk/players';
import { triggerEmote, movePlayerTo } from '~system/RestrictedActions';
import { getTerrainHeight } from '../utils/terrain-height-loader';
import { 
  isPlayerCarryingDiamond, 
  detachDiamondFromPlayer, 
  removeCarriedDiamond,
  getCarriedDiamond,
  getCarriedByPlayer,
  forceRemoveAllDiamondAttachments
} from '../diamonds/diamond-carrying';
// import { sendDiamondCarriedEvent } from '../services/atomic-events'; // ANCIEN SYSTÈME DÉSACTIVÉ
import { createSimpleDroppedDiamond, hasDroppedDiamondFor } from '../diamonds/simple-dropped-diamonds';
import { saveDiamondState, getAllDiamondStates, initPlayerDiamondStates } from '../diamonds/diamond-states-persistence';
import { forceSetDiamondState } from '../diamonds/diamonds';
import { isInAnySafeZone } from '../components/safezones';

// État global
let lastLivesCount = -1; // Start at -1 to indicate not initialized
let deathSystemActive = false;
export let playerInvulnerable = false; // Exporté pour vérification externe
let deathSoundEntity: Entity | null = null;
export function isDeathHandling(): boolean { return isHandlingDeath; }
let deathTextVisible = false;
let deathTextTimer = 0;
let regenTextVisible = false;
let regenTextTimer = 0;
let isHandlingDeath = false; // Guard pour éviter les doubles appels
export let isPlayerDead = false; // Export pour que stamina sache si le joueur est en mort

// Initialiser le système de mort
export function initDeathSystem() {
  // ✅ Log pour voir si on est déjà initialisé
  // console.log(`[DEATH] initDeathSystem called, deathSystemActive=${deathSystemActive}`); // Réduit les logs pour éviter "Message too large"
  
  if (deathSystemActive) {
    // console.log(`[DEATH] Already initialized, skipping`);
    return;
  }
  
  deathSystemActive = true;
  
  // ✅ CRITIQUE: Réinitialiser TOUS les états au spawn
  isHandlingDeath = false; // ✅ Réinitialiser le guard
  isPlayerDead = false; // ✅ Réinitialiser l'état de mort
  playerInvulnerable = false; // ✅ Réinitialiser l'invulnérabilité
  deathTextVisible = false; // ✅ Réinitialiser la visibilité du texte
  regenTextVisible = false;
  deathTextTimer = 0;
  regenTextTimer = 0;
  
  // ✅ CRITIQUE: Initialiser lastLivesCount avec la valeur actuelle pour éviter les morts fictives
  lastLivesCount = PlayerUI.lives;
  // console.log(`[DEATH] ✅ lastLivesCount initialized to ${lastLivesCount} in initDeathSystem`);
  
  // console.log(`[DEATH] ✅ Initialized with full state reset`); // Réduit les logs pour éviter "Message too large"
  // console.log(`[DEATH] States: isHandlingDeath=${isHandlingDeath}, isPlayerDead=${isPlayerDead}, playerInvulnerable=${playerInvulnerable}, deathTextVisible=${deathTextVisible}`); // Réduit les logs pour éviter "Message too large"
  // console.log(`[DEATH] PlayerUI.lives=${PlayerUI.lives}, lastLivesCount=${lastLivesCount}`); // Réduit les logs pour éviter "Message too large"
  
  // Clean up any leftover InputModifiers at spawn
  if (engine.PlayerEntity && InputModifier.has(engine.PlayerEntity)) {
    InputModifier.deleteFrom(engine.PlayerEntity);
    // console.log('[DEATH] ✅ Cleaned up leftover InputModifier at spawn');
  }
  
  // ✅ TOUJOURS créer une NOUVELLE entité audio pour éviter que l'ancienne ne continue à jouer
  if (deathSoundEntity) {
    // Supprimer l'ancienne entité si elle existe
    engine.removeEntity(deathSoundEntity);
    // console.log('[DEATH] Removed old death sound entity');
  }
  
  // Créer l'entité audio pour le son de mort
  deathSoundEntity = engine.addEntity();
  Transform.create(deathSoundEntity, {
    position: Vector3.create(160, 5, 160), // Centre de la carte
    scale: Vector3.create(1, 1, 1)
  });
  
  // Configurer l'AudioSource (début arrêté)
  AudioSource.create(deathSoundEntity, {
    audioClipUrl: 'assets/scene/Audio/death.wav',
    playing: false, // ✅ CRITIQUE: toujours commencer arrêté
    loop: false,
    volume: 1.0,
    global: true  // ✅ Son global pour être audible partout
  });

  
  // console.log('[DEATH] Death sound entity created with playing=false'); // Réduit les logs pour éviter "Message too large"

}

// Jouer le son de mort
function playDeathSound() {
  if (deathSoundEntity) {
    AudioSource.getMutable(deathSoundEntity).playing = true;
    // console.log('[DEATH] Played death sound');
  }
}

// Exporter pour synchronisation multi-joueur
export function getDeathSoundEntity(): Entity | null {
  return deathSoundEntity;
}

// Exporter pour utilisation dans d'autres systèmes
export function isPlayerInvulnerable(): boolean {
  return playerInvulnerable;
}

// Afficher le texte "DEAD" en rouge pendant 3 secondes
function showDeathText() {
  deathTextVisible = true;
  deathTextTimer = 3.0;
  // console.log('[DEATH] Showing DEAD text');
}

// Exporter l'état du texte de mort pour l'UI
export function isDeathTextVisible(): boolean {
  return deathTextVisible;
}

// Afficher le texte "WAIT LIFE REGEN"
export function showRegenText() {
  regenTextVisible = true;
  regenTextTimer = 3.0;
  // console.log('[DEATH] Showing WAIT LIFE REGEN text');
}

// Exporter l'état du texte de regen pour l'UI
export function isRegenTextVisible(): boolean {
  return regenTextVisible;
}

// Update du système de texte de mort et regen
function updateDeathText(dt: number) {
  if (deathTextTimer > 0) {
    deathTextTimer -= dt;
    if (deathTextTimer <= 0) {
      deathTextVisible = false;
    }
  }
  
  if (regenTextTimer > 0) {
    regenTextTimer -= dt;
    if (regenTextTimer <= 0) {
      regenTextVisible = false;
    }
  }
}

// Fonctions pour contrôler le mouvement du joueur
function freezePlayerMovement() {
  if (engine.PlayerEntity) {
    // console.log('[DEATH] Freezing player movement');
    // Disable all movement temporarily
    InputModifier.createOrReplace(engine.PlayerEntity, {
      mode: InputModifier.Mode.Standard({ 
        disableAll: true 
      })

    });
  }
}

function unfreezePlayerMovement() {
  if (engine.PlayerEntity) {
    // console.log('[DEATH] 🔓 Unfreezing player movement');
    
    // ✅ SOLUTION EXPLICITE : Redéclarer l'InputModifier avec tous les mouvements autorisés
    InputModifier.createOrReplace(engine.PlayerEntity, {
      mode: InputModifier.Mode.Standard({
        disableAll: false,
        disableWalk: false,
        disableRun: false,
        disableJog: false,
        disableJump: false,
        disableEmote: false
      })
    });

    // console.log('[DEATH] ✅ InputModifier explicitly set to allow all movement');
  }
}

// Vérifier si le joueur vient de perdre une vie
function checkForPlayerDeath(): boolean {
  const currentLives = PlayerUI.lives;
  const previousLives = lastLivesCount;
  
  // Skip death detection on first frame (initialization)
  if (lastLivesCount === -1) {
    lastLivesCount = currentLives;
    return false;
  }
  
  // Safety check: if we haven't properly initialized, skip
  if (previousLives === -1) {
    return false;
  }
  

  if (playerInvulnerable) {
    lastLivesCount = currentLives;
    return false;
  }
  
  const lifeLost = previousLives > currentLives;
  
  if (lifeLost) {
    // ✅ IMPORTANT: Ne PAS redécrémenter ici (déjà fait par les fantômes)
    // Activer l'invulnérabilité immédiatement pour éviter les pertes multiples
    playerInvulnerable = true;
    // console.log('[DEATH] ⚡ Life lost detected! Invulnerability activated for 2 seconds');

    // Timer d'invulnérabilité 2s dès la détection
    let invulnerabilityTimer = 0;
    const invulnerabilitySystem = (dt: number) => {
      invulnerabilityTimer += dt;
      if (invulnerabilityTimer >= 2.0) {
        playerInvulnerable = false;
        // console.log('[DEATH] ✅ Invulnerability period ended (2s from life loss)');
        engine.removeSystem(invulnerabilitySystem);
      }
    };
    engine.addSystem(invulnerabilitySystem);
  }
  
  lastLivesCount = currentLives;
  return lifeLost;
}

// Gérer la mort du joueur
function handlePlayerDeath() {

  // console.log('[DEATH] ⚡ handlePlayerDeath STARTED');
  
  const player = getPlayer();
  if (!player || !player.userId) {
    console.error('[DEATH] No player found');
    return;
  }
  
  // ✅ GUARD: Éviter les doubles appels (handlePlayerDeath peut être appelé deux fois)
  if (isHandlingDeath) {
    // console.log('[DEATH] Already handling death, skipping duplicate call');
    return;
  }
  isHandlingDeath = true;
  
  if (!player || !player.userId) {
    console.error('[DEATH] No player found');
    isHandlingDeath = false;
    return;
  }

  const playerId = player.userId;
  const playerName = player.name || 'Player';
  
  const playerEntity = engine.PlayerEntity;
  if (!playerEntity || !Transform.has(playerEntity)) {
    console.error('[DEATH] No player entity found');
    return;
  }
  
  const playerPos = Transform.get(playerEntity).position;
  
  // ✅ Jouer le son de mort
  playDeathSound();
  
  // ✅ Afficher "DEAD" en rouge pendant 3 secondes
  showDeathText();
  
  let wasCarryingDiamond = isPlayerCarryingDiamond();
  
  // console.log(`[DEATH] Processing death for player ${playerId}`);
  // console.log(`[DEATH] wasCarryingDiamond (local): ${wasCarryingDiamond}`);
  // console.log(`[DEATH] carriedDiamond:`, getCarriedDiamond());
  // console.log(`[DEATH] carriedByPlayer:`, getCarriedByPlayer());
  
  // ✅ SIMPLIFICATION : Utiliser uniquement l'état LOCAL pour vérifier si le joueur porte un diamant
  // ✅ Plus de vérification Firebase - évite les désynchronisations
  // console.log(`[DEATH] 🔍 LOCAL CHECK: Player carrying diamond: ${wasCarryingDiamond}`);
  // console.log(`[DEATH] 🔍 LOCAL CHECK: Carried diamond entity:`, getCarriedDiamond());
  // console.log(`[DEATH] 🔍 LOCAL CHECK: Carried by player:`, getCarriedByPlayer());
  
  // ✅ VÉRIFICATION FINALE : Si le joueur est dans une safe zone, forcer le nettoyage et ne pas créer de drop
  const playerInSafeZone = isInAnySafeZone(playerPos.x, playerPos.z);
  if (playerInSafeZone) {
    // console.log('[DEATH] 🔥 SAFE ZONE DETECTED: Forcing diamond cleanup to prevent post-validation drops');
    forceRemoveAllDiamondAttachments();
    wasCarryingDiamond = false; // Forcer à false pour éviter le drop
  }

  // ✅ L'invulnérabilité est déjà activée dans checkForPlayerDeath()
  // playerInvulnerable = true; // ❌ REMOVED: Already set in checkForPlayerDeath()
  isPlayerDead = true;
  freezePlayerMovement();
  triggerEmote({ predefinedEmote: 'dontsee' });

  // Gérer le diamant s'il y en a un (LOCAL ONLY)
  if (wasCarryingDiamond) {
    // console.log('[DEATH] Player died with diamond, detaching and dropping...');
    
    // ✅ SOLUTION RADICALE : Forcer la suppression complète de tous les attachments
    import('../diamonds/diamond-carrying').then(({ forceRemoveAllDiamondAttachments }) => {
      forceRemoveAllDiamondAttachments();
    });
    
    // Nettoyer aussi via removeCarriedDiamond pour être sûr
    removeCarriedDiamond();
    
    // Créer le diamant dropped
    const deathPosition = Vector3.create(playerPos.x, playerPos.y, playerPos.z);
    
    // ✅ SIMPLIFICATION : Utiliser un index générique (1) pour les drops
    // ✅ Plus besoin de chercher dans Firebase - on utilise l'état local
    const carriedDiamondIndex = 1; // Index générique pour les drops
    
    // ✅ SIMPLIFICATION : Plus besoin de vérifier, on sait qu'on a un diamant
    {
      // ✅ ÉTAPE 1 : Force detach IMMEDIATEMENT (SYNCHRONE) - EN PREMIER
      // console.log(`[DEATH] 🔥 STEP 1: Force detaching diamond ${carriedDiamondIndex}`);
      
      // Obtenir la référence directe du diamant porté
      const localCarriedDiamond = getCarriedDiamond();
      
      if (localCarriedDiamond && AvatarAttach.has(localCarriedDiamond)) {
        AvatarAttach.deleteFrom(localCarriedDiamond);
      }
      
      forceRemoveAllDiamondAttachments();
      removeCarriedDiamond();
      
      // ✅ ÉTAPE 2 : Vérifier et supprimer UNIQUEMENT les AvatarAttach de diamants
      try {
        for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
          // Vérifier si c'est un diamant avant de supprimer
          if (GltfContainer.has(entity)) {
            const gltf = GltfContainer.get(entity);
            if (gltf.src && gltf.src.includes('diamond.glb')) {
              AvatarAttach.deleteFrom(entity);
              try {
                engine.removeEntity(entity);
              } catch (e) {
                // Ignore si déjà supprimé
              }
            }
          }
        }
      } catch (e) {
        console.error('[DEATH] Error removing AvatarAttach:', e);
      }
      
      // ✅ ÉTAPE 3 : Créer le dropped SYNCHRONEMENT après détachement
      if (!hasDroppedDiamondFor(carriedDiamondIndex)) {
        createSimpleDroppedDiamond(deathPosition, carriedDiamondIndex);
        // console.log(`[DEATH] ✅ Dropped diamond ${carriedDiamondIndex} created synchronously`);
      } else {
        // console.log(`[DEATH] Dropped diamond ${carriedDiamondIndex} already exists, skipping duplicate creation`);
      }
      
      // ✅ ÉTAPE 4 : Mettre l'état local à "dropped" immédiatement
      forceSetDiamondState(carriedDiamondIndex, 'dropped');
      // console.log(`[DEATH] Forced diamond ${carriedDiamondIndex} to 'dropped' state locally`);
      
      // Sauvegarder dans Firebase (asynchrone OK)
      // console.log(`[DEATH] Saving diamond ${carriedDiamondIndex} as dropped in Firebase...`);
      
      // ✅ NOUVELLE ARCHITECTURE : Initialiser les états des diamants pour ce joueur
      initPlayerDiamondStates(playerId).then(() => {
        saveDiamondState(carriedDiamondIndex, 'dropped', {
          droppedBy: playerId,
          droppedAt: Date.now(),
          dropPosition: deathPosition,
          collectedBy: null,
          collectedAt: null
        }).then(() => {
          // console.log(`[DEATH] Diamond ${carriedDiamondIndex} successfully saved as dropped`);
        }).catch(e => console.error('[DEATH] Failed to save dropped state:', e));
      }).catch(e => console.error('[DEATH] Failed to init player diamond states:', e));
    }
    
    // Envoyer l'événement de portage de diamant - DÉSACTIVÉ EN MODE SOLO
    // sendDiamondCarriedEvent(playerId, playerName, false);
  }
  // Téléportation après 2 secondes
  let teleportTimer = 0;
  const teleportDelay = 2;
  let teleportSystemActive = true;
  let hasTeleported = false;
  
  // ✅ Variable globale pour le système de téléport (pour pouvoir le supprimer)
  if (!(globalThis as any).__PLAYER_TELEPORT_SYSTEM__) {
    (globalThis as any).__PLAYER_TELEPORT_SYSTEM__ = null;
  }
  
  // ✅ Supprimer l'ancien système de téléport si il existe
  if ((globalThis as any).__PLAYER_TELEPORT_SYSTEM__) {
    try {
      engine.removeSystem((globalThis as any).__PLAYER_TELEPORT_SYSTEM__);
      // console.log('[DEATH] Removed previous teleport system');
    } catch (e) {
      // Ignore if already removed
    }
  }

  const teleportSystem = (dt: number) => {
    if (!teleportSystemActive) return;
    teleportTimer += dt;
    

    if (teleportTimer >= teleportDelay && !hasTeleported) {
      hasTeleported = true;
      

      const centerX = 160;
      const centerZ = 160;
      const terrainHeight = getTerrainHeight(centerX, centerZ);
      const centerY = terrainHeight + 7.0;
      const centerPosition = Vector3.create(centerX, centerY, centerZ);
      
      // console.log('[DEATH] Teleporting player to center');
      movePlayerTo({ newRelativePosition: centerPosition });
      
      // ✅ DÉBLOCAGE IMMÉDIAT : Débloquer le mouvement immédiatement après téléportation
      unfreezePlayerMovement();
      
      // ✅ SÉCURITÉ: S'assurer que l'invulnérabilité est désactivée après téléportation
      // (en plus du timer de 2s qui devrait déjà l'avoir fait)
      // Utiliser un système ECS pour le timer de sécurité
      let safetyTimer = 0;
      const safetySystem = (dt: number) => {
        safetyTimer += dt;
        if (safetyTimer >= 0.1) { // 100ms
            if (playerInvulnerable) {
              playerInvulnerable = false;
              // console.log('[DEATH] 🔒 SAFETY: Force-disabled invulnerability after teleportation');
          }
          engine.removeSystem(safetySystem);
        }
      };
      engine.addSystem(safetySystem);

      teleportSystemActive = false;
      
      // ✅ Réinitialiser les états AVANT de débloquer
      isPlayerDead = false;
      lastLivesCount = PlayerUI.lives;
      isHandlingDeath = false;
      
      // console.log('[DEATH] ✅ Player respawned - States reset');
      
      // ✅ CRITIQUE : Nettoyage radical de tous les AvatarAttach de diamants APRÈS respawn
      // console.log('[DEATH] 🔥 RADICAL: Removing ALL diamond AvatarAttach after respawn...');
      try {
        for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
          // Vérifier si c'est un diamant avant de supprimer
          if (GltfContainer.has(entity)) {
            const gltf = GltfContainer.get(entity);
            if (gltf.src && gltf.src.includes('diamond.glb')) {
              // console.log(`[DEATH] 🔥 Found diamond AvatarAttach on entity ${entity} AFTER respawn, removing it!`);
              AvatarAttach.deleteFrom(entity);
              try {
                engine.removeEntity(entity);
              } catch (e) {
                // Ignore si déjà supprimé
              }
            }
          }
        }
      } catch (e) {
        console.error('[DEATH] Error removing AvatarAttach:', e);
      }
      
      // ✅ Le déblocage est déjà fait immédiatement après la téléportation
      
      // Remove system immediately after teleport
      engine.removeSystem(teleportSystem);
    }
  };
  

  // ✅ Enregistrer le système dans la variable globale
  (globalThis as any).__PLAYER_TELEPORT_SYSTEM__ = teleportSystem;
  engine.addSystem(teleportSystem);
  
  // Système de vérification simplifié (réduit les logs pour éviter "Message too large")
  let verificationTimer = 0;
  const verificationSystem = (dt: number) => {
    verificationTimer += dt;
    
    // ✅ SÉCURITÉ: Force-disable invulnerability after 3 seconds (safety net)
    if (verificationTimer >= 3.0 && playerInvulnerable) {
      playerInvulnerable = false;
      // console.log('[DEATH] 🔒 SAFETY: Force-disabled invulnerability after 3 seconds');
    }
    
    // Vérifie seulement toutes les 1 seconde pendant 3 secondes
    if (verificationTimer >= 1.0 && verificationTimer < 3.0 && engine.PlayerEntity) {
      verificationTimer = 0;
      
      const hasModifier = InputModifier.has(engine.PlayerEntity);
      
      if (hasModifier && !isPlayerDead) {
        // Forcer un modifier avec tout à false
        InputModifier.createOrReplace(engine.PlayerEntity, {
          mode: InputModifier.Mode.Standard({
            disableAll: false,
            disableWalk: false,
            disableRun: false,
            disableJog: false,
            disableJump: false,
            disableEmote: false
          })
        });
        // ✅ L'invulnérabilité est gérée par le timer de 2s dans checkForPlayerDeath()
        // playerInvulnerable = false; // ❌ REMOVED: Let the 2s timer handle invulnerability
      }
      
      // Si on est bloqué depuis plus de 2 secondes, forcer le nettoyage
      if (verificationTimer >= 2.0 && hasModifier && isPlayerDead) {
        InputModifier.createOrReplace(engine.PlayerEntity, {
          mode: InputModifier.Mode.Standard({
            disableAll: false,
            disableWalk: false,
            disableRun: false,
            disableJog: false,
            disableJump: false,
            disableEmote: false
          })
        });
        isPlayerDead = false;
        // ✅ L'invulnérabilité est gérée par le timer de 2s dans checkForPlayerDeath()
        // playerInvulnerable = false; // ❌ REMOVED: Let the 2s timer handle invulnerability
      }
    }
    
    // Supprimer le système après 3 secondes
    if (verificationTimer >= 3.0) {
      engine.removeSystem(verificationSystem);
    }
  };
  
  engine.addSystem(verificationSystem);

}

// Créer le système de détection de mort
export function createDeathDetectionSystem() {
  if (!deathSystemActive) {
    initDeathSystem();
  }

  engine.addSystem((dt) => {
    const deathDetected = checkForPlayerDeath();
    if (deathDetected) {
      handlePlayerDeath();
    }
    // Update du texte de mort
    updateDeathText(dt);
  });
}

// Fonction pour initialiser lastLivesCount après le chargement Firebase
export function initDeathSystemLastLivesCount(lives: number) {
  if (lastLivesCount === -1) {
    lastLivesCount = lives;
    console.log(`[DEATH] ✅ lastLivesCount initialized to ${lastLivesCount} after Firebase load`);
  }
}

// Fonction pour forcer la détection de mort (utilisée par les fantômes)
export function forceDeathDetection() {

  // ✅ Don't trigger death if still initializing
  if (lastLivesCount === -1) {
    // console.log(`[DEATH] forceDeathDetection called during initialization, skipping`);
    return;
  }
  
  // ✅ Don't trigger if already handling death
  if (isHandlingDeath) {
    // console.log(`[DEATH] forceDeathDetection called but already handling death, skipping`);
    return;
  }
  

  const currentLives = PlayerUI.lives;
  const previousLives = lastLivesCount;
  
  // console.log(`[DEATH] forceDeathDetection called: current=${currentLives}, previous=${previousLives}`);
  

  // ✅ NE PAS modifier lastLivesCount ici - le système de téléport va le faire
  // ❌ lastLivesCount = currentLives; // ❌ REMOVED: teleportSystem does this at line 366
  
  // ✅ Toujours appeler handlePlayerDeath() si appelé explicitement (par les fantômes)
  // La vérification previousLives > currentLives n'est plus nécessaire car 
  // le système de fantômes vérifie déjà que la vie a été perdue

  handlePlayerDeath();
}
