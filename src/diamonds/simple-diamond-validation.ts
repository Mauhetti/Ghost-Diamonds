// ============================================================================
// SIMPLE DIAMOND VALIDATION SYSTEM
// ============================================================================
// Version simplifiée et directe pour la validation des diamants
// ============================================================================

import { engine, Entity, Transform, TriggerArea, triggerAreaEventsSystem, ColliderLayer, MeshRenderer, Material, GltfContainer, AudioSource, AvatarAttach, TextShape, Font, TextAlignMode, Billboard, BillboardMode } from '@dcl/sdk/ecs';
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math';
import * as utils from '@dcl-sdk/utils';
import { getPlayer } from '@dcl/sdk/players';
import { updateLeaderboard } from '../components/leaderboard';
import { setDiamondsCollected } from './diamonds';
import { savePlayerDiamondsRobust, loadPlayerDiamondsRobust } from './robust-diamond-persistence';

// État global
let validationZoneEntity: Entity | null = null;
let lastValidationTime = 0;

// Fonction de nettoyage automatique au démarrage
export async function autoCleanupOnStartup() {
  // console.log('[SIMPLE_VALIDATION] 🚀 AUTO CLEANUP ON STARTUP...');
  
  try {
    const player = getPlayer();
    if (!player) {
      // console.log('[SIMPLE_VALIDATION] ⚠️ No player found during startup cleanup');
      return;
    }
    
    // Vérifier s'il y a des diamants bloqués
    let stuckDiamonds = 0;
    for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
      if (GltfContainer.has(entity)) {
        const gltf = GltfContainer.get(entity);
        if (gltf.src.includes('diamond.glb')) {
          stuckDiamonds++;
        }
      }
    }
    
    if (stuckDiamonds > 0) {
      // console.log(`[SIMPLE_VALIDATION] 🔧 Found ${stuckDiamonds} stuck diamonds, cleaning up...`);
      await resetDiamondCollectionSystem();
    } else {
      // console.log('[SIMPLE_VALIDATION] ✅ No stuck diamonds found');
    }
    
  } catch (error) {
    console.error('[SIMPLE_VALIDATION] ❌ Auto cleanup failed:', error);
  }
}

// Créer la zone de validation simplifiée
export function createSimpleValidationZone(): Entity {
  // console.log('[SIMPLE_VALIDATION] 🔥 Creating simple validation zone...');
  
  // Lancer le nettoyage automatique au démarrage
  autoCleanupOnStartup().catch(() => {}); // Ignorer les erreurs pour ne pas bloquer
  
  // Créer l'entité de la zone
  validationZoneEntity = engine.addEntity();
  // console.log('[SIMPLE_VALIDATION] ✅ Zone entity created:', validationZoneEntity);
  
  // Position de la zone (centre de la safe zone)
  Transform.create(validationZoneEntity, {
    position: Vector3.create(170, 3.6, 160),
    scale: Vector3.create(2.75, 1, 2.75)
  });
  // console.log('[SIMPLE_VALIDATION] ✅ Transform created at (170, 3.6, 160)');
  
  // Zone de déclenchement (même approche que l'ancien système)
  TriggerArea.setBox(validationZoneEntity, ColliderLayer.CL_PLAYER);
  // console.log('[SIMPLE_VALIDATION] ✅ TriggerArea setBox created');
  
  // Événements de trigger
  triggerAreaEventsSystem.onTriggerEnter(validationZoneEntity, (result) => {
    // console.log('[SIMPLE_VALIDATION] 🔥 Player entered validation zone! Result:', result);
    validateDiamond();
  });
  
  triggerAreaEventsSystem.onTriggerExit(validationZoneEntity, (result) => {
    // console.log('[SIMPLE_VALIDATION] Player exited validation zone');
  });
  
  // console.log('[SIMPLE_VALIDATION] ✅ Trigger events registered');
  
  // Créer le coffre GLB à la même position que la zone
  const coffreEntity = engine.addEntity();
  Transform.create(coffreEntity, {
    position: Vector3.create(170, 3.6, 160), // Même position que la zone
    scale: Vector3.create(3, 3, 3), // Scale de 3
    rotation: Quaternion.fromEulerDegrees(0, 270, 0) // Rotation de 270 degrés sur l'axe Y
  });
  
  // Utiliser GltfContainer avec colliders intégrés
  GltfContainer.create(coffreEntity, {
    src: 'assets/scene/Models/coffre/coffre.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  });
  
  // console.log('[SIMPLE_VALIDATION] ✅ Coffre created at (170, 3.6, 160)');
  
  // Créer un panneau au-dessus de la zone
  const signEntity = engine.addEntity();
  Transform.create(signEntity, {
    position: Vector3.create(170, 8.0, 160), // Au-dessus du coffre
    scale: Vector3.create(1, 1, 1)
  });
  
  TextShape.create(signEntity, {
    text: "💎 STORE YOUR DIAMOND HERE 💎",
    fontSize: 2,
    font: Font.F_SANS_SERIF,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textColor: Color4.create(1, 1, 1, 1) // Blanc
  });
  
  Billboard.create(signEntity, {
    billboardMode: BillboardMode.BM_Y
  });
  
  // console.log('[SIMPLE_VALIDATION] ✅ Sign created');
  
  // Rendu visuel de la zone (optionnel, pour debug - désactivé pour ne pas gêner)
  // MeshRenderer.create(validationZoneEntity, {
  //   mesh: {
  //     $case: 'box',
  //     box: {
  //       uvs: []
  //     }
  //   }
  // });
  
  // Material.create(validationZoneEntity, {
  //   material: {
  //     $case: 'pbr',
  //     pbr: {
  //       albedoColor: Color4.create(0, 1, 0, 0.3), // Vert transparent
  //       metallic: 0,
  //       roughness: 1,
  //       transparencyMode: 1 // Alpha blending
  //     }
  //   }
  // });
  
  // console.log('[SIMPLE_VALIDATION] ✅ Simple validation zone created with coffre');
  return validationZoneEntity;
}

// Fonction de validation simplifiée
async function validateDiamond() {
  const currentTime = Date.now();
  
  // Éviter les doublons (attendre 3 secondes entre les validations)
  if (currentTime - lastValidationTime < 3000) {
    // console.log('[SIMPLE_VALIDATION] ⚠️ Validation too soon, ignoring');
    return;
  }
  
  lastValidationTime = currentTime;
  
  // console.log('[SIMPLE_VALIDATION] 🔥 VALIDATION STARTED');
  
  const player = getPlayer();
  if (!player || !player.userId) {
    // console.log('[SIMPLE_VALIDATION] ❌ No player found');
    return;
  }
  
  const playerId = player.userId;
  const playerName = player.name || `Player_${playerId.substring(0, 8)}`;
  
  // console.log(`[SIMPLE_VALIDATION] Player: ${playerName} (${playerId})`);
  
  // Vérifier si le joueur porte un diamant (méthode simple)
  let isCarryingDiamond = false;
  
  // Scanner toutes les entités avec AvatarAttach pour trouver les diamants
  for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
    if (GltfContainer.has(entity)) {
      const gltf = GltfContainer.get(entity);
      if (gltf.src.includes('diamond.glb')) {
        isCarryingDiamond = true;
        // console.log('[SIMPLE_VALIDATION] ✅ Found diamond attached to player');
        break;
      }
    }
  }
  
  if (!isCarryingDiamond) {
    // console.log('[SIMPLE_VALIDATION] ❌ No diamond found on player');
    return;
  }
  
  // console.log('[SIMPLE_VALIDATION] 🔥 DIAMOND FOUND - PROCEEDING WITH VALIDATION');
  
  try {
    // ✅ ÉTAPE 1: MISE À JOUR INSTANTANÉE DE L'UI (AVANT TOUT) - VERSION ULTRA-RAPIDE
    // console.log('[SIMPLE_VALIDATION] 🔥 STEP 1: Getting current count from local state...');
    
    // Utiliser le système de diamants local pour éviter Firebase
    const { getDiamondsCollected } = await import('./diamonds');
    const currentCount = getDiamondsCollected();
    const newCount = currentCount + 1;
    // console.log(`[SIMPLE_VALIDATION] 🔥 STEP 1: Local count: ${currentCount} → New count: ${newCount}`);
    
    // Mettre à jour l'UI IMMÉDIATEMENT
    setDiamondsCollected(newCount);
    // console.log(`[SIMPLE_VALIDATION] ✅ UI updated INSTANTLY to ${newCount} diamonds`);
    
       // ✅ ÉTAPE 2: Jouer le son de validation (en même temps que l'UI)
       // console.log('[SIMPLE_VALIDATION] 🔥 STEP 2: Playing validation sound...');
       playValidationSound();

       // ✅ ÉTAPE 3: Détacher tous les diamants du joueur (LOCAL ONLY)
       // console.log('[SIMPLE_VALIDATION] 🔥 STEP 3: Detaching diamonds (LOCAL)...');
       await detachAllDiamonds(playerId);
    
    // ✅ ÉTAPE 4: Mettre à jour le leaderboard IMMÉDIATEMENT
    // console.log('[SIMPLE_VALIDATION] 🔥 STEP 4: Updating leaderboard...');
    updateLeaderboard(playerName, newCount);
    // console.log('[SIMPLE_VALIDATION] ✅ Leaderboard updated INSTANTLY');
    
       // ✅ ÉTAPE 5: Marquer le diamant comme collecté dans Firebase pour permettre le respawn
       // console.log('[SIMPLE_VALIDATION] 🔥 STEP 5: Marking diamond as collected in Firebase...');
       try {
         const { saveDiamondState, initPlayerDiamondStates } = await import('./diamond-states-persistence');
         
         // Initialiser les états des diamants pour ce joueur
         await initPlayerDiamondStates(playerId);
         
         // Trouver quel diamant était porté et le marquer comme collecté
         // Utiliser un index générique (0) car on ne sait pas exactement lequel était porté
         await saveDiamondState(0, 'collected', {
           collectedBy: playerId,
           collectedAt: Date.now()
         });
         
         // console.log('[SIMPLE_VALIDATION] ✅ Diamond marked as collected in Firebase - respawn will be triggered');
       } catch (error) {
         console.error('[SIMPLE_VALIDATION] ❌ Failed to mark diamond as collected:', error);
       }
       
       // ✅ ÉTAPE 6: Sauvegarder le score dans Firebase (synchronisé avec retry)
       // console.log('[SIMPLE_VALIDATION] 🔥 STEP 6: Saving score to Firebase (NO MUTEX)...');
       let firebaseSaveSuccess = false;
       let retryCount = 0;
       const maxRetries = 3;
       
       while (!firebaseSaveSuccess && retryCount < maxRetries) {
         try {
           // Utiliser une sauvegarde directe sans mutex
           const { savePlayerDiamondsDirect } = await import('./robust-diamond-persistence');
           await savePlayerDiamondsDirect(playerId, playerName, newCount);
           firebaseSaveSuccess = true;
           // console.log(`[SIMPLE_VALIDATION] ✅ Saved ${newCount} diamonds to Firebase (NO MUTEX) - Attempt ${retryCount + 1}`);
         } catch (error) {
           retryCount++;
           console.error(`[SIMPLE_VALIDATION] ❌ Firebase save failed (attempt ${retryCount}):`, error);
           
           if (retryCount < maxRetries) {
             // console.log(`[SIMPLE_VALIDATION] 🔄 Retrying Firebase save in 500ms...`);
             await new Promise(resolve => utils.timers.setTimeout(() => resolve(undefined), 500));
           } else {
             console.error('[SIMPLE_VALIDATION] ❌ Firebase save failed after all retries - using local fallback');
             // Forcer la sauvegarde locale comme fallback
             try {
               const { setDiamondsCollected } = await import('./diamonds');
               setDiamondsCollected(newCount);
               // console.log(`[SIMPLE_VALIDATION] ✅ Fallback: Saved ${newCount} diamonds locally`);
             } catch (fallbackError) {
               console.error('[SIMPLE_VALIDATION] ❌ Even local fallback failed:', fallbackError);
             }
           }
         }
       }
    
    // console.log('[SIMPLE_VALIDATION] ✅ VALIDATION COMPLETED SUCCESSFULLY');
    
  } catch (error) {
    console.error('[SIMPLE_VALIDATION] ❌ Validation failed:', error);
  }
}

// Détacher tous les diamants du joueur
async function detachAllDiamonds(playerAddress: string) {
  let detachedCount = 0;
  
  // Scanner toutes les entités avec AvatarAttach pour trouver les diamants
  for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
    if (GltfContainer.has(entity)) {
      const gltf = GltfContainer.get(entity);
      if (gltf.src.includes('diamond.glb')) {
        // Supprimer l'attachement
        AvatarAttach.deleteFrom(entity);
        detachedCount++;
        
        // ✅ SUPPRIMER COMPLÈTEMENT L'ENTITÉ pour éviter les problèmes
        try {
          engine.removeEntity(entity);
        } catch (error) {
          console.error(`[SIMPLE_VALIDATION] ❌ Error removing entity ${entity}:`, error);
        }
      }
    }
  }
  
  // ✅ NETTOYAGE SUPPLÉMENTAIRE : Forcer la suppression de tous les AvatarAttach de diamants
  let remainingAttachments = 0;
  for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
    if (GltfContainer.has(entity)) {
      const gltf = GltfContainer.get(entity);
      if (gltf.src.includes('diamond.glb')) {
        remainingAttachments++;
        
        // Forcer la suppression
        AvatarAttach.deleteFrom(entity);
        engine.removeEntity(entity);
      }
    }
  }
  
  // ✅ CRITIQUE : Réinitialiser l'état local du système de portage
  const { forceRemoveAllDiamondAttachments, isPlayerCarryingDiamond } = await import('./diamond-carrying');
  
  // Utiliser la fonction robuste qui remet tout à zéro
  forceRemoveAllDiamondAttachments();
  
  // ✅ DEBUG : Vérifier l'état après nettoyage
  const stillCarrying = isPlayerCarryingDiamond(playerAddress);
  // console.log(`[SIMPLE_VALIDATION] 🔍 DEBUG: After cleanup, isPlayerCarryingDiamond: ${stillCarrying}`);
  
  if (stillCarrying) {
    // console.log(`[SIMPLE_VALIDATION] ⚠️ WARNING: Player still appears to be carrying diamond after cleanup!`);
  }
}

// Jouer le son de validation
function playValidationSound() {
  try {
    const soundEntity = engine.addEntity();
    
    Transform.create(soundEntity, {
      position: Vector3.create(170, 5, 160)
    });
    
    AudioSource.create(soundEntity, {
      audioClipUrl: 'assets/scene/Audio/save_diamondi.wav',
      loop: false,
      volume: 0.8,
      playing: true,
      global: true
    });
    
    // Supprimer l'entité après 2 secondes
    utils.timers.setTimeout(() => {
      engine.removeEntity(soundEntity);
    }, 2000);
    
    // console.log('[SIMPLE_VALIDATION] ✅ Validation sound played');
  } catch (error) {
    console.error('[SIMPLE_VALIDATION] ❌ Error playing validation sound:', error);
  }
}

// Fonction de debug pour tester la validation
export function testValidation() {
  // console.log('[SIMPLE_VALIDATION] 🔥 TEST VALIDATION CALLED');
  validateDiamond();
}

// Fonction de debug pour vérifier l'état de la zone
export function debugValidationZone() {
  // console.log('[SIMPLE_VALIDATION] 🔍 DEBUG ZONE STATUS:');
  // console.log('  - Zone entity:', validationZoneEntity);
  // console.log('  - Last validation time:', lastValidationTime);
  
  const player = getPlayer();
  if (player) {
    // console.log('  - Player found:', player.name, player.userId);
    
    // Vérifier si le joueur porte un diamant
    let isCarryingDiamond = false;
    let diamondEntities = [];
    
    for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
      if (GltfContainer.has(entity)) {
        const gltf = GltfContainer.get(entity);
        if (gltf.src.includes('diamond.glb')) {
          isCarryingDiamond = true;
          diamondEntities.push(entity);
        }
      }
    }
    
    // console.log('  - Player carrying diamond:', isCarryingDiamond);
    // console.log('  - Diamond entities:', diamondEntities);
    
    // Vérifier aussi les entités avec GltfContainer diamond
    let diamondGltfEntities = [];
    for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
      const gltf = GltfContainer.get(entity);
      if (gltf.src.includes('diamond.glb')) {
        diamondGltfEntities.push({
          entity: entity,
          hasAvatarAttach: AvatarAttach.has(entity)
        });
      }
    }
    
    // console.log('  - All diamond GltfContainer entities:', diamondGltfEntities);
  } else {
    // console.log('  - No player found');
  }
}

// Fonction pour vérifier l'état des diamants après validation
export function checkDiamondStateAfterValidation() {
  // console.log('[SIMPLE_VALIDATION] 🔍 CHECKING DIAMOND STATE AFTER VALIDATION:');
  
  const player = getPlayer();
  if (!player) {
    // console.log('  - No player found');
    return;
  }
  
  // console.log(`  - Player: ${player.name} (${player.userId})`);
  
  // Vérifier les AvatarAttach
  let avatarAttachDiamonds = [];
  for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
    if (GltfContainer.has(entity)) {
      const gltf = GltfContainer.get(entity);
      if (gltf.src.includes('diamond.glb')) {
        avatarAttachDiamonds.push(entity);
      }
    }
  }
  
  // console.log(`  - AvatarAttach diamonds: ${avatarAttachDiamonds.length}`, avatarAttachDiamonds);
  
  // Vérifier tous les GltfContainer diamond
  let allDiamondEntities = [];
  for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
    const gltf = GltfContainer.get(entity);
    if (gltf.src.includes('diamond.glb')) {
      allDiamondEntities.push({
        entity: entity,
        hasAvatarAttach: AvatarAttach.has(entity),
        hasTransform: Transform.has(entity)
      });
    }
  }
  
  // console.log(`  - All diamond entities: ${allDiamondEntities.length}`, allDiamondEntities);
  
  if (avatarAttachDiamonds.length === 0) {
    // console.log('  ✅ SUCCESS: No diamond attachments found - validation worked!');
  } else {
    // console.log('  ❌ PROBLEM: Still have diamond attachments after validation!');
  }
}

// Fonction de reset pour débloquer la collecte de diamants
export async function resetDiamondCollectionSystem() {
  // console.log('[SIMPLE_VALIDATION] 🔄 RESETTING DIAMOND COLLECTION SYSTEM...');
  
  try {
    // 1. Nettoyer tous les attachments de diamants
    // console.log('[SIMPLE_VALIDATION] 🔄 Step 1: Cleaning all diamond attachments...');
    let cleanedCount = 0;
    
    for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
      if (GltfContainer.has(entity)) {
        const gltf = GltfContainer.get(entity);
        if (gltf.src.includes('diamond.glb')) {
          AvatarAttach.deleteFrom(entity);
          engine.removeEntity(entity);
          cleanedCount++;
          // console.log(`[SIMPLE_VALIDATION] ✅ Cleaned diamond entity ${entity}`);
        }
      }
    }
    
    // console.log(`[SIMPLE_VALIDATION] ✅ Cleaned ${cleanedCount} diamond attachments`);
    
    // 2. Réinitialiser l'état local des diamants
    // console.log('[SIMPLE_VALIDATION] 🔄 Step 2: Resetting local diamond state...');
    const { removeCarriedDiamond } = await import('./diamond-carrying');
    removeCarriedDiamond();
    // console.log('[SIMPLE_VALIDATION] ✅ Local diamond state reset');
    
    // 3. Forcer la synchronisation Firebase/Local
    // console.log('[SIMPLE_VALIDATION] 🔄 Step 3: Syncing Firebase with local state...');
    const { getDiamondsCollected, setDiamondsCollected } = await import('./diamonds');
    const { savePlayerDiamondsRobust } = await import('./robust-diamond-persistence');
    
    const player = getPlayer();
    if (player) {
      const currentCount = getDiamondsCollected();
      const playerName = player.name || `Player_${player.userId.substring(0, 8)}`;
      
      try {
        await savePlayerDiamondsRobust(player.userId, playerName, currentCount);
        // console.log(`[SIMPLE_VALIDATION] ✅ Firebase synced with local count: ${currentCount}`);
      } catch (error) {
        console.error('[SIMPLE_VALIDATION] ❌ Firebase sync failed:', error);
      }
    }
    
    // 4. Vérifier l'état final
    // console.log('[SIMPLE_VALIDATION] 🔄 Step 4: Final state check...');
    checkDiamondStateAfterValidation();
    
    // console.log('[SIMPLE_VALIDATION] ✅ DIAMOND COLLECTION SYSTEM RESET COMPLETE');
    // console.log('[SIMPLE_VALIDATION] 💡 You should now be able to collect diamonds again!');
    
  } catch (error) {
    console.error('[SIMPLE_VALIDATION] ❌ Reset failed:', error);
  }
}

// Fonction pour nettoyer les états Firebase corrompus
export async function cleanupCorruptedFirebaseStates() {
  console.log('[SIMPLE_VALIDATION] 🧹 CLEANING CORRUPTED FIREBASE STATES...');
  
  try {
    const player = getPlayer();
    if (!player) {
      console.log('  ❌ No player found');
      return;
    }
    
    console.log(`  - Player: ${player.name} (${player.userId})`);
    
    // Importer les fonctions nécessaires
    const { saveDiamondState, initPlayerDiamondStates } = await import('./diamond-states-persistence');
    
    // Initialiser les états des diamants pour ce joueur
    await initPlayerDiamondStates(player.userId);
    
    // Nettoyer tous les diamants marqués comme "carried" par ce joueur
    console.log('[SIMPLE_VALIDATION] 🧹 Step 1: Cleaning carried states...');
    
    for (let i = 0; i < 5; i++) {
      try {
        // Marquer tous les diamants comme "available" pour les remettre en circulation
        await saveDiamondState(i, 'available', {
          collectedBy: null,
          collectedAt: null
        });
        console.log(`[SIMPLE_VALIDATION] ✅ Cleaned diamond_${i} state`);
      } catch (error) {
        console.error(`[SIMPLE_VALIDATION] ❌ Error cleaning diamond_${i}:`, error);
      }
    }
    
    console.log('[SIMPLE_VALIDATION] ✅ FIREBASE STATES CLEANUP COMPLETE');
    console.log('[SIMPLE_VALIDATION] 💡 All diamonds should now be available for collection!');
    
  } catch (error) {
    console.error('[SIMPLE_VALIDATION] ❌ Cleanup failed:', error);
  }
}

// Exposer les fonctions de debug globalement
(globalThis as any).testValidation = testValidation;
(globalThis as any).debugValidationZone = debugValidationZone;
(globalThis as any).checkDiamondStateAfterValidation = checkDiamondStateAfterValidation;
(globalThis as any).resetDiamondCollectionSystem = resetDiamondCollectionSystem;
(globalThis as any).cleanupCorruptedFirebaseStates = cleanupCorruptedFirebaseStates;
