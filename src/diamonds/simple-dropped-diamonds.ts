// ============================================================================
// SIMPLE DROPPED DIAMONDS SYSTEM
// ============================================================================ 
// Système simplifié pour les diamants tombés lors de la mort d'un joueur.
// Un seul système qui gère tout : visuel + état + timer + collecte.
// ============================================================================ 

import { engine, Entity, Transform, GltfContainer, TextShape, Font, TextAlignMode, Billboard, BillboardMode } from '@dcl/sdk/ecs';
import { Vector3, Color4 } from '@dcl/sdk/math';
import { getPlayer } from '@dcl/sdk/players';
import { saveDiamondState } from './diamond-states-persistence';
import { isPlayerInvulnerable } from '../systems/death';
import { createCarriedDiamond, attachDiamondToPlayer } from './diamond-carrying';

// Configuration simple
const SIMPLE_DROPPED_CONFIG = {
  LIFETIME: 30, // 30 secondes
  COLLECTION_DISTANCE: 2.0,
  SCALE: 0.5, // Même taille que les diamants originaux
  TEXT_SIZE: 4,
  GRACE_PERIOD_COLLECT: 5.0 // Délai de grâce avant collecte (5 secondes) - Empêche collecte après mort
};

// État global simple
let droppedDiamonds: Array<{
  entity: Entity;
  textEntity: Entity;
  position: Vector3;
  createdAt: number;
  diamondIndex: number; // Index du diamant original dans le système principal
}> = [];

// Créer un diamant tombé simple
export function createSimpleDroppedDiamond(position: Vector3, diamondIndex: number): Entity {
  console.log(`[SIMPLE_DROPPED] Creating dropped diamond ${diamondIndex} at:`, position);
  
  // Créer l'entité du diamant
  const diamondEntity = engine.addEntity();
  
  Transform.create(diamondEntity, {
    position: Vector3.create(position.x, position.y + 0.5, position.z),
    scale: Vector3.create(SIMPLE_DROPPED_CONFIG.SCALE, SIMPLE_DROPPED_CONFIG.SCALE, SIMPLE_DROPPED_CONFIG.SCALE)
  });
  
  GltfContainer.create(diamondEntity, { src: 'assets/scene/Models/diamond/diamond.glb' });
  
  // Créer le texte
  const textEntity = engine.addEntity();
  
  Transform.create(textEntity, {
    position: Vector3.create(position.x, position.y + 2, position.z)
  });
  
  TextShape.create(textEntity, {
    text: `💎 DROPPED #${diamondIndex}\n${SIMPLE_DROPPED_CONFIG.LIFETIME}s`,
    fontSize: SIMPLE_DROPPED_CONFIG.TEXT_SIZE,
    textColor: Color4.create(1, 0, 0, 1), // Rouge
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    font: Font.F_SANS_SERIF
  });
  
  Billboard.create(textEntity, { billboardMode: BillboardMode.BM_Y });
  
  // Ajouter à la liste
  droppedDiamonds.push({
    entity: diamondEntity,
    textEntity: textEntity,
    position: Vector3.create(position.x, position.y, position.z),
    createdAt: Date.now(),
    diamondIndex: diamondIndex
  });
  
  console.log(`[SIMPLE_DROPPED] Dropped diamond ${diamondIndex} created successfully`);
  return diamondEntity;
}

// Mettre à jour les diamants tombés
export function updateSimpleDroppedDiamonds(dt: number): void {
  const currentTime = Date.now();
  
  for (let i = droppedDiamonds.length - 1; i >= 0; i--) {
    const dropped = droppedDiamonds[i];
    const elapsed = (currentTime - dropped.createdAt) / 1000;
    const remaining = Math.max(0, SIMPLE_DROPPED_CONFIG.LIFETIME - elapsed);
    
    // Mettre à jour le texte avec le temps restant
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    TextShape.getMutable(dropped.textEntity).text = `💎 DROPPED #${dropped.diamondIndex}\nExpire dans ${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Effet de pulsation (optionnel)
    const pulse = Math.sin(elapsed * 2.0) * 0.1 + 1.0;
    const diamondTransform = Transform.getMutable(dropped.entity);
    diamondTransform.scale = Vector3.create(
      SIMPLE_DROPPED_CONFIG.SCALE * pulse,
      SIMPLE_DROPPED_CONFIG.SCALE * pulse,
      SIMPLE_DROPPED_CONFIG.SCALE * pulse
    );
    
    // Mettre à jour la position du texte
    const textTransform = Transform.getMutable(dropped.textEntity);
    textTransform.position = Vector3.create(
      diamondTransform.position.x,
      diamondTransform.position.y + 1.5,
      diamondTransform.position.z
    );
    
    // Supprimer si expiré
    if (remaining <= 0) {
      console.log(`[SIMPLE_DROPPED] Dropped diamond ${dropped.diamondIndex} expired, removing.`);
      
      engine.removeEntity(dropped.entity);
      engine.removeEntity(dropped.textEntity);
      droppedDiamonds.splice(i, 1);
      
      // NE PAS sauvegarder 'respawning' dans Firebase - c'est un état local transitoire
      // Le système de respawn local gère la transition
      console.log(`[SIMPLE_DROPPED] Dropped diamond ${dropped.diamondIndex} expired, removing (no Firebase save)`);
    }
  }
}

// Vérifier la collecte d'un diamant tombé
export function checkSimpleDroppedCollection(playerPos: Vector3): number | null {
  const player = getPlayer();
  if (!player) return null;
  
  // Vérifier si le joueur est invulnérable
  if (isPlayerInvulnerable()) {
    return null;
  }
  
  for (let i = 0; i < droppedDiamonds.length; i++) {
    const dropped = droppedDiamonds[i];
    const elapsed = (Date.now() - dropped.createdAt) / 1000;
    
    // Pas collectable pendant les premières secondes (période de grâce)
    if (elapsed < SIMPLE_DROPPED_CONFIG.GRACE_PERIOD_COLLECT) continue;
    
    const dx = playerPos.x - dropped.position.x;
    const dz = playerPos.z - dropped.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance <= SIMPLE_DROPPED_CONFIG.COLLECTION_DISTANCE) {
      return i;
    }
  }
  
  return null;
}

// Collecter un diamant tombé
export function collectSimpleDroppedDiamond(index: number): { entity: Entity, diamondIndex: number } | null {
  if (index < 0 || index >= droppedDiamonds.length) {
    console.log(`[SIMPLE_DROPPED] Invalid collection index: ${index}`);
    return null;
  }
  
  const dropped = droppedDiamonds[index];
  console.log(`[SIMPLE_DROPPED] Collecting dropped diamond ${dropped.diamondIndex}`);
  
  // Vérifier si le joueur est invulnérable (ne devrait pas arriver ici si checkSimpleDroppedCollection est bien utilisé)
  if (isPlayerInvulnerable()) {
    console.log(`[SIMPLE_DROPPED] Player is invulnerable, cannot collect dropped diamond ${dropped.diamondIndex}`);
    return null;
  }
  
  // ✅ Obtenir l'ID du joueur actuel
  const currentPlayer = getPlayer();
  const playerId = currentPlayer?.userId || 'unknown_player';
  
  // Mettre à jour l'état Firebase du diamant original à 'carried'
  saveDiamondState(dropped.diamondIndex, 'carried', {
    collectedBy: playerId, // ✅ Utiliser l'ID réel du joueur
    collectedAt: Date.now(),
    dropPosition: null, // Nettoyer les infos de drop
    droppedAt: null,
    droppedBy: null
  }).catch(e => {
    console.error(`[SIMPLE_DROPPED] Failed to update diamond ${dropped.diamondIndex} to carried state:`, e);
  });
  
  // Supprimer le texte
  engine.removeEntity(dropped.textEntity);
  
  // ✅ Note : L'état local sera mis à 'carried' par le système principal
  // via la synchronisation Firebase ou par attachDiamondToPlayer
  
  const diamondIndex = dropped.diamondIndex;
  
  // Retirer de la liste
  droppedDiamonds.splice(index, 1);
  
  return { entity: dropped.entity, diamondIndex };
}

// Obtenir le nombre de diamants tombés
export function getSimpleDroppedCount(): number {
  return droppedDiamonds.length;
}

// Nettoyer tous les diamants tombés (appelé au spawn et sur reload)
export function clearSimpleDroppedDiamonds(): void {
  // Chercher et supprimer tous les diamants dropped orphelins après reload
  for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
    try {
      const gltf = GltfContainer.get(entity);
      const transform = Transform.getOrNull(entity);
      
      // Vérifier si c'est un diamant (par le chemin du modèle)
      if (gltf.src && gltf.src.includes('diamond.glb')) {
        // Vérifier si c'est un diamant orphelin (petit scale = diamant porté détruit)
        if (!transform || transform.scale.x < 0.2) {
          console.log(`[SIMPLE_DROPPED] Removing orphaned diamond entity ${entity}`);
          engine.removeEntity(entity);
        }
      }
    } catch (e) {
      // Ignorer les erreurs
    }
  }
  
  // Nettoyer aussi tous les TextShape orphelins liés aux diamants dropped
  for (const [entity] of engine.getEntitiesWith(TextShape)) {
    try {
      const textShape = TextShape.get(entity);
      if (textShape.text.includes('💎 DROPPED')) {
        console.log(`[SIMPLE_DROPPED] Removing orphaned dropped diamond text entity ${entity}`);
        engine.removeEntity(entity);
      }
    } catch (e) {
      // Ignorer les erreurs
    }
  }
  
  // Supprimer les entités de la liste locale
  for (const dropped of droppedDiamonds) {
    try {
      engine.removeEntity(dropped.entity);
      engine.removeEntity(dropped.textEntity);
    } catch (e) {
      // Ignorer les erreurs
    }
  }
  
  droppedDiamonds = [];
  // console.log('[SIMPLE_DROPPED] Cleared dropped diamonds'); // Réduit les logs pour éviter "Message too large"
}

// Vérifier si un dropped diamond existe déjà pour un index donné
export function hasDroppedDiamondFor(diamondIndex: number): boolean {
  return droppedDiamonds.some(dropped => dropped.diamondIndex === diamondIndex);
}

// Retirer un dropped diamond par son index de diamant
export function removeDroppedDiamondFor(diamondIndex: number): void {
  const currentTime = Date.now();
  
  for (let i = droppedDiamonds.length - 1; i >= 0; i--) {
    const dropped = droppedDiamonds[i];
    if (dropped.diamondIndex === diamondIndex) {
      // ✅ PROTECTION: Ne pas supprimer un dropped diamond créé récemment
      // pour éviter la suppression prématurée pendant la synchronisation Firebase
      const age = currentTime - dropped.createdAt;
      const lifetime = SIMPLE_DROPPED_CONFIG.LIFETIME * 1000; // Convert to milliseconds
      
      // Ne pas supprimer si le dropped est toujours "jeune" (pas encore expiré)
      if (age < lifetime) {
        const remaining = (lifetime - age) / 1000;
        console.log(`[SIMPLE_DROPPED] ⚠️ Blocked removal of dropped diamond ${diamondIndex} (${remaining.toFixed(1)}s remaining)`);
        return;
      }
      
      console.log(`[SIMPLE_DROPPED] Removing dropped diamond for index ${diamondIndex}`);
      engine.removeEntity(dropped.entity);
      engine.removeEntity(dropped.textEntity);
      droppedDiamonds.splice(i, 1);
    }
  }
}