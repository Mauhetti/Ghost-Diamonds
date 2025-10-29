// ============================================================================
// DIAMOND VALIDATION SYSTEM
// ============================================================================
// Handles the validation and collection of diamonds in the central safe zone.
// When a player carrying a diamond enters the safe zone, the diamond is:
// 1. Detached from the player
// 2. Counted towards their total diamond collection
// 3. Saved to persistent storage via Firebase
// 4. The leaderboard is updated to reflect the new count
// ============================================================================

import { engine, Entity, Transform, TriggerArea, triggerAreaEventsSystem, ColliderLayer, MeshRenderer, Material, TextShape, Font, TextAlignMode, Billboard, BillboardMode, GltfContainer, AudioSource, AvatarAttach } from '@dcl/sdk/ecs';
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math';
import * as utils from '@dcl-sdk/utils';
import { isInAnySafeZone } from '../components/safezones';
import { detachDiamondFromPlayer, isPlayerCarryingDiamond, getCarriedByPlayer, removeCarriedDiamond, getCarriedDiamond, forceRemoveAllDiamondAttachments, forceUpdateFirebaseStateAfterCleanup } from './diamond-carrying';
import { savePlayerDiamondsRobust, loadPlayerDiamondsRobust } from './robust-diamond-persistence';
import { getPlayer } from '@dcl/sdk/players';
import { updateLeaderboard } from '../components/leaderboard';
import { getAllDiamondStates, saveDiamondState } from './diamond-states-persistence';
import { clearDiamondCollectedBy, setDiamondsCollected, respawnDiamond } from './diamonds';

// État global
let centralSafeZoneEntity: Entity | null = null;
let validationSystemActive = false;
let lastValidationTime = 0;
let validationSoundEntity: Entity | null = null;
let validationInProgress = false;
let validationStartTime = 0;

// Créer la zone de validation centrale
export function createCentralValidationZone(): Entity {
  // ✅ TOUJOURS recréer pour éviter les problèmes de reload
  // Reset des variables globales
  centralSafeZoneEntity = null;
  validationSoundEntity = null;

  const zone = engine.addEntity();
  
  // Position alignée sur le coffre (170, 3.6, 160) - descendue à y=3.6
  Transform.create(zone, {
    position: Vector3.create(170, 3.6, 160),
    scale: Vector3.create(2.75, 1, 2.75) // Zone de 2.75x2.75 mètres (réduite de 0.25)
  });

  // Créer une zone de déclenchement cubique (plus précise)
  TriggerArea.setBox(zone, ColliderLayer.CL_PLAYER);
  
  // Zone de debug invisible (zone de trigger seulement)
  const debugZone = engine.addEntity();
  Transform.create(debugZone, {
    position: Vector3.create(170, 3.6, 160),
    scale: Vector3.create(2.75, 1, 2.75) // Même taille que la zone de trigger (réduite de 0.25)
  });
  
  // Zone invisible - pas de MeshRenderer ni Material

  // Créer le coffre GLB à la même position que la zone bleue
  const coffreEntity = engine.addEntity();
  Transform.create(coffreEntity, {
    position: Vector3.create(170, 3.6, 160), // Même position que la zone bleue descendue
    scale: Vector3.create(3, 3, 3), // Scale de 3
    rotation: Quaternion.fromEulerDegrees(0, 270, 0) // Rotation de 270 degrés (90 + 180) sur l'axe Y
  });
  
  // Utiliser GltfContainer avec colliders intégrés (même approche que la plateforme centrale)
  GltfContainer.create(coffreEntity, {
    src: 'assets/scene/Models/coffre/coffre.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  });

  // Créer un panneau au-dessus de la zone
  const signEntity = engine.addEntity();
  Transform.create(signEntity, {
    position: Vector3.create(170, 8.0, 160), // Descendu de 0.7 unités
    scale: Vector3.create(1, 1, 1)
  });
  
  TextShape.create(signEntity, {
    text: "💎 STORE YOUR DIAMOND HERE 💎",
    fontSize: 3, // GROS pour être visible de loin
    textColor: Color4.create(1, 1, 1, 1), // Blanc
    outlineColor: Color4.create(0, 0, 0, 1), // Contour noir
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    font: Font.F_SANS_SERIF
  });
  
  Billboard.create(signEntity, {
    billboardMode: BillboardMode.BM_Y // Toujours face au joueur
  });

  // ✅ Créer l'entité audio pour le son de validation (invisible)
  validationSoundEntity = engine.addEntity();
  Transform.create(validationSoundEntity, {
    position: Vector3.create(170, 3.6, 160), // Même position que le coffre
    scale: Vector3.create(1, 1, 1)
  });
  
  // Configurer l'AudioSource (début arrêté)
  AudioSource.create(validationSoundEntity, {
    audioClipUrl: 'assets/scene/Audio/save_diamondi.wav',
    playing: false, // Démarrera quand la validation se produit
    loop: false,
    volume: 1.0,
    global: true  // ✅ Son global pour être audible partout
  });

  // Écouter l'entrée dans la zone
  triggerAreaEventsSystem.onTriggerEnter(zone, (otherEntity) => {
    validateCarriedDiamond();
  });

  // Écouter la sortie de la zone (optionnel, pour debug)
  triggerAreaEventsSystem.onTriggerExit(zone, (otherEntity) => {
  });

  // Système de validation par position (plus fiable)
  engine.addSystem((dt: number) => {
    try {
      const player = engine.PlayerEntity;
      if (!player || !Transform.has(player)) return;

      const playerPos = Transform.get(player).position;
      const zoneCenter = Vector3.create(170, 3.6, 160); // Même position que la zone de trigger
      const zoneSize = 1.375; // Rayon de la zone (2.75/2)

      // Calculer la distance au centre de la zone
      const distance = Math.sqrt(
        Math.pow(playerPos.x - zoneCenter.x, 2) + 
        Math.pow(playerPos.z - zoneCenter.z, 2)
      );

      // ✅ DEBUG: Log périodique pour vérifier la détection de zone
      if (Math.floor(Date.now() / 1000) % 5 === 0) { // Log toutes les 5 secondes
        console.log(`[DIAMOND_VALIDATION] Player pos: (${playerPos.x.toFixed(1)}, ${playerPos.z.toFixed(1)}), distance: ${distance.toFixed(2)}, zoneSize: ${zoneSize}`);
      }

      // ✅ SURVEILLANCE: Réinitialiser validationInProgress si bloqué trop longtemps (30 secondes)
      if (validationInProgress) {
        const currentTime = Date.now();
        const validationDuration = currentTime - validationStartTime;
        if (validationDuration > 30000) { // 30 secondes
          console.log(`[DIAMOND_VALIDATION] ⚠️ Validation stuck for ${validationDuration}ms, forcing reset`);
          validationInProgress = false;
          validationStartTime = 0;
        }
      }

      // Si le joueur est dans la zone (distance < rayon de la zone)
      if (distance < zoneSize) {
        const currentTime = Date.now();
        // Éviter les doublons (attendre 2 secondes entre les validations)
        if (currentTime - lastValidationTime < 2000) return;
        
        console.log(`[DIAMOND_VALIDATION] Player entered validation zone! Distance: ${distance.toFixed(2)}`);
        lastValidationTime = currentTime;
        validateCarriedDiamond();
      }
    } catch (error) {
      console.error('[DIAMOND_VALIDATION_SYSTEM] ❌ Error in validation system:', error);
      if (error instanceof Error) {
        console.error('[DIAMOND_VALIDATION_SYSTEM] ❌ Error stack:', error.stack);
      }
    }
  });

  centralSafeZoneEntity = zone;
  validationSystemActive = true;
  
  console.log('[DIAMOND_VALIDATION] ✅ Central validation zone created at (170, 3.6, 160)');
  console.log('[DIAMOND_VALIDATION] ✅ Validation system active');
  
  return zone;
}

// Jouer le son de validation
function playValidationSound() {
  if (validationSoundEntity) {
    // Jouer le son en le mettant à playing = true
    AudioSource.getMutable(validationSoundEntity).playing = true;
    // console.log('[DIAMOND_VALIDATION] Played validation sound'); // DÉSACTIVÉ pour réduire les logs
  }
}

// Valider le diamant porté - VERSION CONFORME DCLContext
async function validateCarriedDiamond() {
  console.log('[DIAMOND_VALIDATION] 🔥 VALIDATION CALLED');
  
  // ✅ Protection anti-doublon : empêcher les validations multiples simultanées
  if (validationInProgress) {
    console.log('[DIAMOND_VALIDATION] ⚠️ Validation already in progress, ignoring duplicate call');
    return;
  }
  
  const player = getPlayer();
  if (!player || !player.userId) {
    console.log('[DIAMOND_VALIDATION] ❌ No player found');
    return;
  }

  const playerId = player.userId;
  
  // ✅ VALIDATION ET AMÉLIORATION DU NOM DU JOUEUR
  let playerName = player.name;
  
  // Vérifier et nettoyer le nom
  if (!playerName || playerName.trim() === '' || playerName === 'null' || playerName === 'undefined') {
    // Générer un nom de fallback basé sur l'adresse
    const addressShort = playerId.substring(0, 8);
    playerName = `Player_${addressShort}`;
    console.log(`[DIAMOND_VALIDATION] ⚠️ Invalid player name, using fallback: ${playerName}`);
  } else {
    // Nettoyer le nom (enlever caractères spéciaux, limiter la longueur)
    playerName = playerName.trim()
      .replace(/[^\w\s-]/g, '') // Garder seulement lettres, chiffres, espaces et tirets
      .substring(0, 20); // Limiter à 20 caractères
    
    if (playerName.length === 0) {
      const addressShort = playerId.substring(0, 8);
      playerName = `Player_${addressShort}`;
    }
  }

  // Vérifier si le joueur porte un diamant
  const isCarrying = isPlayerCarryingDiamond(playerId);
  console.log(`[DIAMOND_VALIDATION] Player ${playerName} is carrying: ${isCarrying}`);
  
  if (!isCarrying) {
    console.log('[DIAMOND_VALIDATION] ❌ Player is not carrying a diamond');
    return;
  }
  
  // Marquer comme en cours
  validationInProgress = true;
  validationStartTime = Date.now();
  // console.log('[DIAMOND_VALIDATION] ✅ validationInProgress set to true'); // DÉSACTIVÉ pour réduire les logs

  console.log(`[DIAMOND_VALIDATION] ✅ Validating diamond for ${playerName}`); // Gardé car important

  try {
    // ✅ Jouer le son de validation (audible par tous les joueurs)
    playValidationSound();
    
    // ✅ ÉTAPE 1: Trouver le diamant porté dans Firebase
    const diamondStates = getAllDiamondStates();
    let diamondIndex = -1;
    
    console.log(`[DIAMOND_VALIDATION] Searching for carried diamond for player ${playerId}...`);
    
    for (let i = 0; i < 5; i++) {
      const state = diamondStates[`diamond_${i}`];
      if (state && state.state === 'carried' && state.collectedBy === playerId) {
        diamondIndex = i;
        console.log(`[DIAMOND_VALIDATION] Found carried diamond ${i}, proceeding with validation...`);
        break;
      }
    }
    
    if (diamondIndex === -1) {
      console.error('[DIAMOND_VALIDATION] ❌ No carried diamond found in Firebase states!');
      throw new Error('No carried diamond found in Firebase states');
    }
    
    // ✅ ÉTAPE 2: DÉTACHEMENT ROBUSTE ET COMPLET (SYNCHRONE) - EN PREMIER
    console.log('[DIAMOND_VALIDATION] 🔥 STEP 2: ROBUST diamond detachment STARTED');
    
    // ✅ MÉTHODE 1: Détachement standard
    const carriedDiamond = getCarriedDiamond();
    let detachmentSuccessful = false;
    
    if (carriedDiamond) {
      console.log('[DIAMOND_VALIDATION] 🔥 Found carried diamond, attempting standard detachment');
      
      try {
        // Supprimer AvatarAttach avec vérification multiple
        if (AvatarAttach.has(carriedDiamond)) {
          AvatarAttach.deleteFrom(carriedDiamond);
          
          // ✅ VÉRIFICATION DOUBLE : S'assurer que l'attachement est vraiment supprimé
          let attempts = 0;
          const maxAttempts = 5;
          while (AvatarAttach.has(carriedDiamond) && attempts < maxAttempts) {
            AvatarAttach.deleteFrom(carriedDiamond);
            attempts++;
            console.log(`[DIAMOND_VALIDATION] 🔥 AvatarAttach removal attempt ${attempts}/${maxAttempts}`);
          }
          
          if (AvatarAttach.has(carriedDiamond)) {
            console.error('[DIAMOND_VALIDATION] ❌ Failed to remove AvatarAttach after multiple attempts');
          } else {
            console.log('[DIAMOND_VALIDATION] ✅ AvatarAttach successfully removed');
          }
        }
        
        // Détacher et nettoyer
        detachDiamondFromPlayer();
        removeCarriedDiamond();
        
        // Supprimer l'entité
        if (Transform.has(carriedDiamond)) {
          try {
            if (Material.has(carriedDiamond)) {
              Material.deleteFrom(carriedDiamond);
            }
            engine.removeEntity(carriedDiamond);
            console.log('[DIAMOND_VALIDATION] ✅ Carried diamond entity removed');
            detachmentSuccessful = true;
          } catch (error) {
            console.error('[DIAMOND_VALIDATION] ❌ Error removing carried diamond:', error);
          }
        }
      } catch (error) {
        console.error('[DIAMOND_VALIDATION] ❌ Error in standard detachment:', error);
      }
    }
    
    // ✅ MÉTHODE 2: Nettoyage d'urgence si la méthode 1 échoue
    if (!detachmentSuccessful) {
      console.log('[DIAMOND_VALIDATION] 🔥 Standard detachment failed, using EMERGENCY cleanup');
      forceRemoveAllDiamondAttachments();
      
      // ✅ MÉTHODE 3: Nettoyage forcé de tous les AvatarAttach de diamants
      try {
        console.log('[DIAMOND_VALIDATION] 🔥 FORCE CLEANUP: Removing ALL diamond AvatarAttach');
        for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
          if (GltfContainer.has(entity)) {
            const gltf = GltfContainer.get(entity);
            if (gltf.src && gltf.src.includes('diamond.glb')) {
              console.log('[DIAMOND_VALIDATION] 🔥 FORCE CLEANUP: Removing diamond AvatarAttach');
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
        console.error('[DIAMOND_VALIDATION] ❌ Error in force cleanup:', e);
      }
    }
    
    // ✅ MÉTHODE 4: Vérification finale et nettoyage d'état
    console.log('[DIAMOND_VALIDATION] 🔥 FINAL STATE CLEANUP');
    forceRemoveAllDiamondAttachments();
    removeCarriedDiamond();
    
    // ✅ ÉTAPE CRITIQUE : Mettre à jour l'état Firebase AVANT la vérification finale
    console.log('[DIAMOND_VALIDATION] 🔥 UPDATING FIREBASE STATE: Setting diamond to collected');
    await saveDiamondState(diamondIndex, 'collected', {
      collectedBy: playerId,
      collectedAt: Date.now()
    });
    
    // ✅ ÉTAPE SUPPLÉMENTAIRE : Forcer la mise à jour de tous les états Firebase
    console.log('[DIAMOND_VALIDATION] 🔥 FORCE UPDATE: Updating all Firebase states');
    await forceUpdateFirebaseStateAfterCleanup(playerId);
    
    // ✅ VÉRIFICATION FINALE : S'assurer qu'aucun diamant n'est porté
    const finalCheck = isPlayerCarryingDiamond(playerId);
    if (finalCheck) {
      console.error('[DIAMOND_VALIDATION] ❌ CRITICAL: Player still carrying diamond after cleanup!');
      // Dernière tentative de nettoyage
      forceRemoveAllDiamondAttachments();
    } else {
      console.log('[DIAMOND_VALIDATION] ✅ FINAL CHECK: No diamond carried - cleanup successful');
    }

    // ✅ ÉTAPE 3: Sauvegarder dans Firebase avec protection contre les conflits
    const currentDiamonds = await loadPlayerDiamondsRobust(playerId);
    const newCount = currentDiamonds + 1;
    console.log(`[DIAMOND_VALIDATION] Player had ${currentDiamonds} diamonds, new count: ${newCount}`);

    // ✅ PROTECTION: Utiliser une transaction Firebase pour éviter les conflits
    const saveSuccess = await savePlayerDiamondsRobust(playerId, playerName, newCount);
    if (!saveSuccess) {
      console.error(`[DIAMOND_VALIDATION] ❌ Failed to save diamonds to Firebase!`);
      throw new Error('Failed to save diamonds to Firebase');
    }
    console.log(`[DIAMOND_VALIDATION] ✅ Successfully saved ${newCount} diamonds for ${playerName}`);
    
    // ✅ ÉTAPE 4: Mettre à jour l'état du diamant vers 'emerging' avec collectedBy=null
    try {
      await saveDiamondState(diamondIndex, 'emerging', {
        spawnPosition: { x: 160, y: 10, z: 160 },
        spawnedAt: Date.now(),
        expiresAt: Date.now() + (5 * 60 * 1000),
        collectedBy: null, // ✅ CRITIQUE: Nettoyer collectedBy immédiatement
        collectedAt: null,
        dropPosition: null,
        droppedAt: null,
        droppedBy: null,
        collectTimer: 0,
        collectTimerStartedAt: null
      });
      console.log(`[DIAMOND_VALIDATION] ✅ Diamond ${diamondIndex} state saved to 'emerging' in Firebase`);
    } catch (e) {
      console.error(`[DIAMOND_VALIDATION] ❌ Failed to save diamond state:`, e);
      throw new Error(`Failed to save diamond state: ${e}`);
    }
    
    // ✅ ÉTAPE 5: Nettoyer les états locaux APRÈS la sauvegarde Firebase
    clearDiamondCollectedBy(diamondIndex);
    console.log(`[DIAMOND_VALIDATION] ✅ Cleared diamondCollectedBy[${diamondIndex}] locally`);
    
    // ✅ ÉTAPE 7: MISE À JOUR INSTANTANÉE DE L'UI (AVANT Firebase)
    setDiamondsCollected(newCount);
    console.log(`[DIAMOND_VALIDATION] ✅ Updated local diamondsCollected to ${newCount} (INSTANT UI UPDATE)`);
    
    // ✅ ÉTAPE 8: Mettre à jour l'UI et le leaderboard APRÈS confirmation Firebase
    // Attendre un court délai pour s'assurer que Firebase est synchronisé
    await new Promise(resolve => utils.timers.setTimeout(() => resolve(undefined), 50)); // Réduit de 100ms à 50ms
    
    updateLeaderboard(playerName, newCount);
    console.log('[DIAMOND_VALIDATION] ✅ Leaderboard updated');
    
    // ✅ RAFRAÎCHISSEMENT FORCÉ du leaderboard avec délai pour Firebase
    if ((globalThis as any).forceRefreshLeaderboard) {
      utils.timers.setTimeout(() => {
        (globalThis as any).forceRefreshLeaderboard();
      }, 200); // Réduit de 500ms à 200ms pour que Firebase soit synchronisé
    }
    
    // ✅ ÉTAPE 9: Envoyer l'événement de fin de portage - DÉSACTIVÉ EN MODE SOLO
    // sendDiamondCarriedEvent(playerId, playerName, false);
    
    // ✅ ÉTAPE 10: Forcer le respawn du diamant
    respawnDiamond(diamondIndex);
    console.log(`[DIAMOND_VALIDATION] ✅ Diamond ${diamondIndex} respawn initiated`);

    console.log('[DIAMOND_VALIDATION] ✅ Validation completed successfully');

  } catch (error) {
    console.error('[DIAMOND_VALIDATION] ❌ Error during validation:', error);
    if (error instanceof Error) {
      console.error('[DIAMOND_VALIDATION] ❌ Error stack:', error.stack);
    }
    
    // ✅ NETTOYAGE D'URGENCE : Forcer le détachement du diamant même en cas d'erreur
    console.log('[DIAMOND_VALIDATION] 🔥 Emergency cleanup: forcing diamond detachment');
    try {
      forceRemoveAllDiamondAttachments();
      
      // Mettre à jour l'UI avec le compte actuel (au cas où la sauvegarde aurait réussi)
      const currentDiamonds = await loadPlayerDiamondsRobust(playerId);
      setDiamondsCollected(currentDiamonds);
      console.log(`[DIAMOND_VALIDATION] 🔥 Emergency UI update: ${currentDiamonds} diamonds`);
    } catch (cleanupError) {
      console.error('[DIAMOND_VALIDATION] ❌ Emergency cleanup failed:', cleanupError);
    }
  } finally {
    // Réinitialiser le flag de validation en cours
    validationInProgress = false;
    console.log('[DIAMOND_VALIDATION] ✅ validationInProgress reset to false');
  }
}

// Vérifier si le joueur est dans la safe zone centrale
export function isPlayerInCentralSafeZone(): boolean {
  const player = engine.PlayerEntity;
  if (!player || !Transform.has(player)) return false;
  
  const playerPos = Transform.get(player).position;
  const zoneCenter = Vector3.create(170, 3.6, 160);
  const zoneSize = 1.375;
  
  const distance = Math.sqrt(
    Math.pow(playerPos.x - zoneCenter.x, 2) + 
    Math.pow(playerPos.z - zoneCenter.z, 2)
  );
  
  return distance < zoneSize;
}

// ✅ FONCTION DE DEBUG : Vérifier l'état du système de validation
export function getValidationSystemStatus(): {
  active: boolean;
  zoneCreated: boolean;
  validationInProgress: boolean;
  playerInZone: boolean;
  playerCarryingDiamond: boolean;
  playerPosition: Vector3 | null;
  zoneCenter: Vector3;
  zoneSize: number;
} {
  const player = engine.PlayerEntity;
  let playerPos: Vector3 | null = null;
  let playerInZone = false;
  let playerCarryingDiamond = false;
  
  if (player && Transform.has(player)) {
    playerPos = Transform.get(player).position;
    const zoneCenter = Vector3.create(170, 3.6, 160);
    const zoneSize = 1.375;
    
    const distance = Math.sqrt(
      Math.pow(playerPos.x - zoneCenter.x, 2) + 
      Math.pow(playerPos.z - zoneCenter.z, 2)
    );
    
    playerInZone = distance < zoneSize;
    
    const playerData = getPlayer();
    if (playerData && playerData.userId) {
      playerCarryingDiamond = isPlayerCarryingDiamond(playerData.userId);
    }
  }
  
  return {
    active: validationSystemActive,
    zoneCreated: centralSafeZoneEntity !== null,
    validationInProgress,
    playerInZone,
    playerCarryingDiamond,
    playerPosition: playerPos,
    zoneCenter: Vector3.create(170, 3.6, 160),
    zoneSize: 1.375
  };
}

// ✅ FONCTION DE DEBUG : Exposer le statut globalement
(globalThis as any).getValidationSystemStatus = getValidationSystemStatus;

// ✅ FONCTION DE DEBUG : Forcer la validation (pour test)
export function forceValidationTest(): void {
  const player = getPlayer();
  if (!player || !player.userId) {
    console.log('[DIAMOND_VALIDATION] ❌ No player found for force test');
    return;
  }
  
  console.log('[DIAMOND_VALIDATION] 🔥 FORCE VALIDATION TEST STARTED');
  console.log('[DIAMOND_VALIDATION] Player:', player.name, 'ID:', player.userId);
  
  const status = getValidationSystemStatus();
  console.log('[DIAMOND_VALIDATION] System status:', status);
  
  if (status.playerInZone && status.playerCarryingDiamond) {
    console.log('[DIAMOND_VALIDATION] ✅ Conditions met - calling validateCarriedDiamond()');
    validateCarriedDiamond();
  } else {
    console.log('[DIAMOND_VALIDATION] ❌ Conditions not met:');
    console.log('  - Player in zone:', status.playerInZone);
    console.log('  - Player carrying diamond:', status.playerCarryingDiamond);
  }
}

// ✅ FONCTION DE DEBUG : Exposer forceValidationTest globalement
(globalThis as any).forceValidationTest = forceValidationTest;

// Obtenir l'entité de la zone de validation
export function getCentralValidationZone(): Entity | null {
  return centralSafeZoneEntity;
}

// Activer/désactiver le système de validation
export function setValidationSystemActive(active: boolean) {
  validationSystemActive = active;
  // Système activé/désactivé
}

// Vérifier si le système est actif
export function isValidationSystemActive(): boolean {
  return validationSystemActive;
}

// Obtenir l'entité audio de validation (pour synchronisation multi-joueur)
export function getValidationSoundEntity(): Entity | null {
  return validationSoundEntity;
}