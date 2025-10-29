// ============================================================================
// DIAMOND CARRYING SYSTEM
// ============================================================================
// Manages the visual attachment and detachment of diamonds to/from player avatars.
// This system handles the core mechanic of players carrying diamonds in their hands,
// with automatic synchronization across all connected players via AvatarAttach.
// ============================================================================

import { engine, Entity, Transform, AvatarAttach, AvatarAnchorPointType, VisibilityComponent, MeshRenderer, Material, GltfContainer, AudioSource } from '@dcl/sdk/ecs';
import { Vector3, Quaternion } from '@dcl/sdk/math';
import { getPlayer } from '@dcl/sdk/players';
import { getAllDiamondStates } from './diamond-states-persistence';

// État global du portage des diamants
let carriedDiamond: Entity | null = null;
let carriedByPlayer: string | null = null;
let isCarryingDiamond = false;
let collectSoundEntity: Entity | null = null;

// Initialiser l'entité audio pour le son de collecte
export function initCollectSound() {
  if (collectSoundEntity) return;
  
  collectSoundEntity = engine.addEntity();
  Transform.create(collectSoundEntity, {
    position: Vector3.create(160, 5, 160), // Centre de la carte
    scale: Vector3.create(1, 1, 1)
  });
  
  // Configurer l'AudioSource (début arrêté)
  AudioSource.create(collectSoundEntity, {
    audioClipUrl: 'assets/scene/Audio/take.wav',
    playing: false, // Démarre quand la collecte se produit
    loop: false,
    volume: 1.0,
    global: true  // ✅ Son global pour être audible partout
  });
}

// Jouer le son de collecte
function playCollectSound() {
  if (collectSoundEntity) {
    AudioSource.getMutable(collectSoundEntity).playing = true;
  }
}

// Exporter pour synchronisation multi-joueur
export function getCollectSoundEntity(): Entity | null {
  return collectSoundEntity;
}

// Créer un diamant porté (plus petit et stylisé)
export function createCarriedDiamond(): Entity {
  const diamond = engine.addEntity();
  
  // Créer un diamant plus petit et stylisé pour le portage
  Transform.create(diamond, {
    position: Vector3.create(0, 0, 0),
    scale: Vector3.create(0.3, 0.3, 0.3) // Plus petit que les diamants normaux
  });
  
  // Utiliser le modèle GLB de diamant (garder ses textures originales)
  GltfContainer.create(diamond, { src: 'assets/scene/Models/diamond/diamond.glb' });
  
  return diamond;
}

// Attacher un diamant à la main droite du joueur
export function attachDiamondToPlayer(diamondEntity: Entity, playerId: string): boolean {
  if (isCarryingDiamond) {
    return false;
  }
  
  try {
    // ✅ Jouer le son de collecte (audible par tous les joueurs)
    playCollectSound();
    
    // Attacher le diamant à la main droite du joueur
    AvatarAttach.create(diamondEntity, {
      anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND
    });
    
    // Mettre à jour l'état global
    carriedDiamond = diamondEntity;
    carriedByPlayer = playerId;
    isCarryingDiamond = true;
    
    return true;
  } catch (error) {
    console.error('[DIAMOND_CARRY] Error attaching diamond:', error);
    return false;
  }
}

// Détacher le diamant du joueur
export function detachDiamondFromPlayer(): Entity | null {
  if (!carriedDiamond) {
    return null;
  }
  
  try {
    // Supprimer l'attachement même s'il n'existe pas (pour être sûr)
    if (AvatarAttach.has(carriedDiamond)) {
      AvatarAttach.deleteFrom(carriedDiamond);
      
      // ✅ VÉRIFICATION DOUBLE : S'assurer que l'attachement est vraiment supprimé
      let attempts = 0;
      const maxAttempts = 5;
      while (AvatarAttach.has(carriedDiamond) && attempts < maxAttempts) {
        AvatarAttach.deleteFrom(carriedDiamond);
        attempts++;
      }
      
      if (AvatarAttach.has(carriedDiamond)) {
        console.error('[DIAMOND_CARRY] ⚠️ Failed to remove AvatarAttach after multiple attempts');
      }
    }
    
    // Récupérer la position du joueur pour placer le diamant
    const player = engine.PlayerEntity;
    if (player && Transform.has(player)) {
      const playerPos = Transform.get(player).position;
      const playerTransform = Transform.getMutable(carriedDiamond);
      playerTransform.position = Vector3.create(
        playerPos.x,
        playerPos.y + 1, // Légèrement au-dessus du sol
        playerPos.z
      );
    }
    
    const detachedDiamond = carriedDiamond;
    
    // Réinitialiser l'état global IMMÉDIATEMENT après détachement
    carriedDiamond = null;
    carriedByPlayer = null;
    isCarryingDiamond = false;
    
    return detachedDiamond;
  } catch (error) {
    console.error('[DIAMOND_CARRY] Error detaching diamond:', error);
    // Réinitialiser l'état même en cas d'erreur
    carriedDiamond = null;
    carriedByPlayer = null;
    isCarryingDiamond = false;
    return null;
  }
}

// Vérifier si le joueur porte un diamant - VERSION LOCALE UNIQUEMENT
export function isPlayerCarryingDiamond(playerId?: string): boolean {
  // ✅ PRIORITÉ 1: Vérifier directement l'entité locale (le plus fiable)
  if (carriedDiamond && AvatarAttach.has(carriedDiamond)) {
    // Vérifier que c'est bien attaché au bon joueur
    if (!playerId || carriedByPlayer === playerId) {
      return true;
    }
  }
  
  // ✅ PRIORITÉ 2: Vérifier l'état local uniquement
  const localCarrying = playerId ? isCarryingDiamond && carriedByPlayer === playerId : isCarryingDiamond;
  if (localCarrying) {
    return true;
  }
  
  return false;
}

// Obtenir l'entité du diamant porté
export function getCarriedDiamond(): Entity | null {
  return carriedDiamond;
}

// Obtenir l'ID du joueur qui porte le diamant
export function getCarriedByPlayer(): string | null {
  return carriedByPlayer;
}

// Supprimer le diamant porté (en cas de mort)
export function removeCarriedDiamond(): void {
  const diamondToRemove = carriedDiamond;
  
  if (diamondToRemove) {
    console.log('[DIAMOND_CARRY] Removing carried diamond entity');
    
    // ✅ Supprimer AvatarAttach EN PREMIER avant de réinitialiser l'état
    try {
      if (AvatarAttach.has(diamondToRemove)) {
        AvatarAttach.deleteFrom(diamondToRemove);
        console.log('[DIAMOND_CARRY] ✅ AvatarAttach removed');
      } else {
        console.log('[DIAMOND_CARRY] ⚠️ No AvatarAttach to remove');
      }
    } catch (error) {
      console.error('[DIAMOND_CARRY] ❌ Error removing AvatarAttach:', error);
    }
    
    // Nettoyer les matériaux avant suppression
    if (Material.has(diamondToRemove)) {
      Material.deleteFrom(diamondToRemove);
    }
    
    // Supprimer l'entité
    engine.removeEntity(diamondToRemove);
    console.log('[DIAMOND_CARRY] Carried diamond entity removed');
  }
  
  // ✅ Réinitialiser l'état global APRÈS la suppression
  carriedDiamond = null;
  carriedByPlayer = null;
  isCarryingDiamond = false;
}

// Faire tomber le diamant à une position spécifique
export function dropDiamondAt(position: Vector3): Entity | null {
  if (!isCarryingDiamond || !carriedDiamond) {
    console.log('[DIAMOND_CARRY] No diamond to drop');
    return null;
  }
  
  try {
    // Détacher le diamant
    AvatarAttach.deleteFrom(carriedDiamond);
    
    // Placer le diamant à la position spécifiée
    const diamondTransform = Transform.getMutable(carriedDiamond);
    diamondTransform.position = Vector3.create(position.x, position.y + 0.5, position.z);
    diamondTransform.scale = Vector3.create(0.5, 0.5, 0.5); // Taille normale pour les diamants tombés
    
    const droppedDiamond = carriedDiamond;
    
    // Réinitialiser l'état global
    carriedDiamond = null;
    carriedByPlayer = null;
    isCarryingDiamond = false;
    
    console.log(`[DIAMOND_CARRY] Diamond dropped at position:`, position);
    return droppedDiamond;
  } catch (error) {
    console.error('[DIAMOND_CARRY] Error dropping diamond:', error);
    return null;
  }
}

// Synchroniser l'état du portage entre joueurs
export function syncCarryingState(playerId: string, isCarrying: boolean, diamondEntity?: Entity): void {
  if (isCarrying && diamondEntity) {
    carriedDiamond = diamondEntity;
    carriedByPlayer = playerId;
    isCarryingDiamond = true;
    // État synchronisé: porté
  } else {
    carriedDiamond = null;
    carriedByPlayer = null;
    isCarryingDiamond = false;
    // État synchronisé: non porté
  }
}

// ✅ SOLUTION ROBUSTE : Supprimer TOUS les AvatarAttach de diamants avec vérifications multiples
export function forceRemoveAllDiamondAttachments(): void {
  let removedCount = 0;
  
  // ✅ ÉTAPE 1: Sauvegarder l'entité locale AVANT de la remettre à null
  const localCarriedDiamond = carriedDiamond;
  
  // ✅ ÉTAPE 2: Réinitialiser l'état global IMMÉDIATEMENT
  carriedDiamond = null;
  carriedByPlayer = null;
  isCarryingDiamond = false;
  
  // ✅ ÉTAPE 3: Nettoyer l'entité locale si elle existe
  if (localCarriedDiamond) {
    try {
      if (AvatarAttach.has(localCarriedDiamond)) {
        AvatarAttach.deleteFrom(localCarriedDiamond);
      }
      engine.removeEntity(localCarriedDiamond);
      removedCount++;
    } catch (e) {
      console.error('[DIAMOND_CARRY] Error removing local diamond:', e);
    }
  }
  
  // ✅ ÉTAPE 4: Chercher et supprimer TOUS les AvatarAttach ayant le modèle de diamant
  try {
    for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
      if (GltfContainer.has(entity)) {
        const gltf = GltfContainer.get(entity);
        
        // Vérifier si c'est un diamant (par le chemin du modèle)
        if (gltf.src && gltf.src.includes('diamond.glb')) {
          // Supprimer AvatarAttach avec vérification multiple
          AvatarAttach.deleteFrom(entity);
          
          // Vérification double
          let attempts = 0;
          const maxAttempts = 3;
          while (AvatarAttach.has(entity) && attempts < maxAttempts) {
            AvatarAttach.deleteFrom(entity);
            attempts++;
          }
          
          // Supprimer l'entité
          try {
            engine.removeEntity(entity);
            removedCount++;
          } catch (e) {
            // Entity already removed
          }
        }
      }
    }
    
    // ✅ ÉTAPE 5: Double vérification de l'état
    if (isCarryingDiamond || carriedDiamond || carriedByPlayer) {
      console.error('[DIAMOND_CARRY] ❌ State not properly reset!');
      // Forcer le reset une dernière fois
      carriedDiamond = null;
      carriedByPlayer = null;
      isCarryingDiamond = false;
    }
    
  } catch (error) {
    console.error('[DIAMOND_CARRY] ❌ Error in robust cleanup:', error);
    
    // En cas d'erreur, forcer le reset de l'état
    carriedDiamond = null;
    carriedByPlayer = null;
    isCarryingDiamond = false;
  }
}

// ✅ FONCTION DE DEBUG : Forcer la synchronisation de l'état local
export function forceSyncLocalState(): void {
  console.log('[DIAMOND_CARRY] 🔄 FORCE SYNC: Starting local state synchronization');
  
  // Scanner toutes les entités avec AvatarAttach pour trouver les diamants
  let foundDiamonds = 0;
  for (const [entity] of engine.getEntitiesWith(AvatarAttach)) {
    if (GltfContainer.has(entity)) {
      const gltf = GltfContainer.get(entity);
      if (gltf.src.includes('diamond.glb')) {
        foundDiamonds++;
        console.log(`[DIAMOND_CARRY] 🔄 Found diamond AvatarAttach on entity ${entity}`);
        
        // Mettre à jour l'état local
        carriedDiamond = entity;
        isCarryingDiamond = true;
        
        // Essayer de déterminer le joueur
        const player = getPlayer();
        if (player && player.userId) {
          carriedByPlayer = player.userId;
          console.log(`[DIAMOND_CARRY] 🔄 Synced state: entity ${entity}, player ${player.userId}`);
        }
      }
    }
  }
  
  if (foundDiamonds === 0) {
    console.log('[DIAMOND_CARRY] 🔄 No diamond AvatarAttach found, resetting state');
    carriedDiamond = null;
    carriedByPlayer = null;
    isCarryingDiamond = false;
  }
  
  console.log(`[DIAMOND_CARRY] 🔄 SYNC COMPLETE: Found ${foundDiamonds} diamonds, isCarryingDiamond: ${isCarryingDiamond}`);
}

// ✅ FONCTION DE DEBUG : Exposer forceSyncLocalState globalement
(globalThis as any).forceSyncLocalState = forceSyncLocalState;

// ✅ FONCTION SPÉCIALISÉE : Forcer la mise à jour de l'état Firebase après nettoyage
export async function forceUpdateFirebaseStateAfterCleanup(playerId: string): Promise<void> {
  try {
    console.log('[DIAMOND_CARRY] 🔥 FORCE UPDATE: Updating Firebase states after cleanup');
    
    // Importer la fonction de sauvegarde d'état
    const { saveDiamondState } = await import('./diamond-states-persistence');
    
    // Mettre à jour tous les diamants portés par ce joueur
    const diamondStates = getAllDiamondStates();
    let updatedCount = 0;
    
    for (let i = 0; i < 5; i++) {
      const state = diamondStates[`diamond_${i}`];
      if (state && state.state === 'carried' && state.collectedBy === playerId) {
        console.log(`[DIAMOND_CARRY] 🔥 FORCE UPDATE: Updating diamond ${i} from carried to available`);
        await saveDiamondState(i, 'available', {
          collectedBy: null,
          collectedAt: null
        });
        updatedCount++;
      }
    }
    
    console.log(`[DIAMOND_CARRY] ✅ FORCE UPDATE: Updated ${updatedCount} diamond states in Firebase`);
  } catch (error) {
    console.error('[DIAMOND_CARRY] ❌ Error in force Firebase update:', error);
  }
}
