// src/diamond-sync.ts
// Système de synchronisation des diamants entre joueurs

import { engine, Entity, Transform } from '@dcl/sdk/ecs';
import { Vector3 } from '@dcl/sdk/math';
import { createSimpleDroppedDiamond, collectSimpleDroppedDiamond, getSimpleDroppedCount } from './simple-dropped-diamonds';
import { syncCarryingState } from './diamond-carrying';
import { getPlayer } from '@dcl/sdk/players';

// État global de synchronisation
let syncSystemActive = false;
let lastSyncTime = 0;
const syncInterval = 1; // Synchroniser toutes les secondes

// Traiter les événements de collecte de diamants
function handleDiamondCollectEvent(event: any) {
  const player = getPlayer();
  if (!player || !player.userId) return;
  
  // Ignorer les événements de notre propre joueur
  if (event.playerId === player.userId) {
    // console.log(`[DIAMOND_SYNC] Ignoring own diamond_collect event`); // Réduit les logs pour éviter "Message too large"
    return;
  }
  
  console.log(`[DIAMOND_SYNC] ✅ Synced diamond collection for player ${event.playerId}`);
}

// Traiter les événements de diamants tombés
function handleDiamondDroppedEvent(event: any) {
  const player = getPlayer();
  if (!player || !player.userId) return;
  
  // Ignorer les événements de notre propre joueur
  if (event.playerId === player.userId) {
    // console.log(`[DIAMOND_SYNC] Ignoring own diamond_dropped event`); // Réduit les logs pour éviter "Message too large"
    return;
  }
  
  const position = Vector3.create(event.position.x, event.position.y, event.position.z);
  const droppedDiamond = createSimpleDroppedDiamond(position, 0); // Index par défaut pour les événements
  
  if (droppedDiamond) {
    console.log(`[DIAMOND_SYNC] ✅ Created dropped diamond from other player ${event.playerId}`);
  } else {
    console.error(`[DIAMOND_SYNC] ❌ Failed to create dropped diamond`);
  }
}

// Traiter les événements d'état de portage
function handleDiamondCarriedEvent(event: any) {
  const player = getPlayer();
  if (!player || !player.userId) return;
  
  // Ignorer les événements de notre propre joueur
  if (event.playerId === player.userId) {
    // console.log(`[DIAMOND_SYNC] Ignoring own diamond_carried event`); // Réduit les logs pour éviter "Message too large"
    return;
  }
  
  // Synchroniser l'état de portage des autres joueurs
  syncCarryingState(event.playerId, event.isCarrying, undefined);
  console.log(`[DIAMOND_SYNC] ✅ Synced carrying state for player ${event.playerId}: ${event.isCarrying}`);
}

// Traiter les événements de collecte de diamants tombés
function handleDiamondDroppedCollectedEvent(event: any) {
  const player = getPlayer();
  if (!player || !player.userId) return;
  
  // Ignorer les événements de notre propre joueur
  if (event.playerId === player.userId) {
    // console.log(`[DIAMOND_SYNC] Ignoring own diamond_dropped_collected event`); // Réduit les logs pour éviter "Message too large"
    return;
  }
  
  // Vérifier si l'index est valide
  if (event.droppedIndex >= 0 && event.droppedIndex < getSimpleDroppedCount()) {
    const result = collectSimpleDroppedDiamond(event.droppedIndex);
    if (result) {
      engine.removeEntity(result.entity);
      // Forcer l'état à 'carried'
      import('./diamonds').then(({ forceSetDiamondState }) => {
        forceSetDiamondState(result.diamondIndex, 'carried');
      });
    }
    console.log(`[DIAMOND_SYNC] ✅ Collected dropped diamond ${event.droppedIndex} for player ${event.playerId}`);
  } else {
    console.log(`[DIAMOND_SYNC] Invalid dropped diamond index: ${event.droppedIndex}`);
  }
}

// Traiter tous les événements reçus - DÉSACTIVÉ EN MODE SOLO
async function processDiamondEvents() {
  // Le système d'événements atomiques a été supprimé car inutile en mode solo
  return;
}


// Créer le système de synchronisation
export function createDiamondSyncSystem() {
  if (syncSystemActive) {
    return;
  }

  syncSystemActive = true;

  engine.addSystem((dt) => {
    const currentTime = Date.now() / 1000;
    
    // Synchroniser à intervalles réguliers
    if (currentTime - lastSyncTime > syncInterval) {
      lastSyncTime = currentTime;
      processDiamondEvents().catch(error => {
        console.error('[DIAMOND_SYNC] Error in processDiamondEvents:', error);
      });
    }
  });
}

// Vérifier si le système de synchronisation est actif
export function isDiamondSyncActive(): boolean {
  return syncSystemActive;
}

// Désactiver le système de synchronisation
export function deactivateDiamondSync() {
  syncSystemActive = false;
}

// Forcer la synchronisation des diamants
export async function forceDiamondSync() {
  await processDiamondEvents();
}