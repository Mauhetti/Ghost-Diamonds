// ============================================================================
// DIAMOND STATES PERSISTENCE SYSTEM
// ============================================================================
// Architecture complète pour persister l'état des diamants avec :
// - Coordonnées de spawn (fixes)
// - Coordonnées de drop (si applicable) 
// - États complets (available, collected, dropped, hidden)
// - Timestamps pour toutes les transitions
// ============================================================================

import { Vector3 } from '@dcl/sdk/math';
import * as utils from '@dcl-sdk/utils';
import { FIREBASE_CONFIG } from '../config-firebase';

const RTDB_URL = FIREBASE_CONFIG.RTDB_URL;

// Types pour l'architecture diamond states
export interface DiamondState {
  // État actuel
  state: 'available' | 'collected' | 'dropped' | 'hidden' | 'emerging' | 'collectible' | 'disappearing' | 'respawning' | 'carried';
  
  // Qui a collecté le diamant
  collectedBy: string | null;
  collectedAt: number | null;
  
  // Coordonnées de spawn (fixes)
  spawnPosition: Vector3;
  spawnedAt: number;
  
  // Coordonnées de drop (si applicable)
  dropPosition: Vector3 | null;
  droppedAt: number | null;
  droppedBy: string | null;
  
  // Timer de collecte (pour persister le temps restant)
  collectTimer: number;
  collectTimerStartedAt: number | null;
  
  // Expiration
  expiresAt: number;
  
  // Compteur de respawn (pour éviter que les diamants respawnent toujours au même endroit)
  respawnCount?: number;
}

export interface DiamondStatesData {
  [key: string]: DiamondState;
}

// ✅ NOUVELLE ARCHITECTURE : États des diamants isolés par joueur
let playerDiamondStates: DiamondStatesData = {};
let playerDiamondStatesLoaded = false;
let currentPlayerId: string | null = null;

// Initialiser les états des diamants pour un joueur spécifique
export async function initPlayerDiamondStates(playerId: string): Promise<void> {
  if (currentPlayerId === playerId && playerDiamondStatesLoaded) {
    return; // Déjà chargé pour ce joueur
  }
  
  currentPlayerId = playerId;
  playerDiamondStatesLoaded = false;
  
  try {
    // console.log(`[DIAMOND_STATES] 🔄 Loading diamond states for player: ${playerId}`);
    
    const response = await fetch(`${RTDB_URL}/players/${playerId}/diamonds.json`);
    if (response.ok) {
      const data = await response.json();
      playerDiamondStates = data || {};
      // console.log(`[DIAMOND_STATES] ✅ Loaded ${Object.keys(playerDiamondStates).length} diamond states for player ${playerId}`);
    } else {
      // console.log(`[DIAMOND_STATES] ⚠️ No existing diamond states for player ${playerId}, initializing...`);
      playerDiamondStates = {};
    }
    
    playerDiamondStatesLoaded = true;
  } catch (error) {
    console.error(`[DIAMOND_STATES] ❌ Error loading diamond states for player ${playerId}:`, error);
    playerDiamondStates = {};
    playerDiamondStatesLoaded = true;
  }
}

// Sauvegarder l'état d'un diamant pour un joueur spécifique
export async function saveDiamondState(
  index: number, 
  state: DiamondState['state'], 
  data: Partial<DiamondState> = {}
): Promise<boolean> {
  if (!currentPlayerId) {
    console.error('[DIAMOND_STATES] ❌ No player ID set for diamond state save');
    return false;
  }
  
  try {
    const currentState = playerDiamondStates[`diamond_${index}`] || {
      state: 'available',
      collectedBy: null,
      collectedAt: null,
      spawnPosition: Vector3.create(0, 0, 0),
      spawnedAt: Date.now(),
      dropPosition: null,
      droppedAt: null,
      droppedBy: null,
      collectTimer: 0,
      collectTimerStartedAt: null,
      expiresAt: Date.now() + (10 * 60 * 1000) // 10 minutes
    };

    // Mettre à jour l'état localement
    const updatedState: DiamondState = {
      ...currentState,
      ...data,
      state
    };

    playerDiamondStates[`diamond_${index}`] = updatedState;

    // ✅ Sauvegarder dans Firebase sous le joueur spécifique
    const response = await fetch(`${RTDB_URL}/players/${currentPlayerId}/diamonds/diamond_${index}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedState)
    });

    // console.log(`[DIAMOND_STATES] ✅ Saved diamond ${index} state for player ${currentPlayerId}: ${state}`);
    return response.ok;
  } catch (error) {
    // ✅ PROTECTION: Ignorer les erreurs d'annulation (CancellationTokenSource disposed)
    if (error instanceof Error && (error.message.includes('CancellationTokenSource') || error.message.includes('disposed'))) {
      return false; // Ignorer silencieusement
    }
    console.error('[DIAMOND_STATES] Error saving diamond state:', error);
    return false;
  }
}

// Charger les états des diamants pour le joueur actuel
export async function loadPlayerDiamondStates(): Promise<DiamondStatesData> {
  if (!currentPlayerId) {
    console.error('[DIAMOND_STATES] ❌ No player ID set for loading diamond states');
    return {};
  }
  
  if (playerDiamondStatesLoaded) {
    return playerDiamondStates;
  }

  await initPlayerDiamondStates(currentPlayerId);
  return playerDiamondStates;
}

// Fonction pour forcer le rechargement des états
export async function reloadPlayerDiamondStates(): Promise<DiamondStatesData> {
  if (!currentPlayerId) {
    console.error('[DIAMOND_STATES] ❌ No player ID set for reloading diamond states');
    return {};
  }
  
  playerDiamondStatesLoaded = false;
  return await loadPlayerDiamondStates();
}

// Obtenir l'état d'un diamant pour le joueur actuel
export function getDiamondState(index: number): DiamondState | null {
  return playerDiamondStates[`diamond_${index}`] || null;
}

// Obtenir tous les états pour le joueur actuel
export function getAllDiamondStates(): DiamondStatesData {
  return { ...playerDiamondStates };
}

// Mettre à jour la position de spawn d'un diamant
export async function updateDiamondSpawnPosition(
  index: number, 
  position: Vector3
): Promise<boolean> {
  return await saveDiamondState(index, 'available', {
    spawnPosition: position,
    spawnedAt: Date.now(),
    expiresAt: Date.now() + (10 * 60 * 1000) // 10 minutes
  });
}

// Mettre à jour la position de drop d'un diamant
export async function updateDiamondDropPosition(
  index: number,
  position: Vector3,
  droppedBy: string
): Promise<boolean> {
  return await saveDiamondState(index, 'dropped', {
    dropPosition: position,
    droppedAt: Date.now(),
    droppedBy
  });
}

// Marquer un diamant comme collecté
export async function markDiamondCollected(
  index: number,
  collectedBy: string
): Promise<boolean> {
  return await saveDiamondState(index, 'collected', {
    collectedBy,
    collectedAt: Date.now()
  });
}

// Marquer un diamant comme caché
export async function markDiamondHidden(index: number): Promise<boolean> {
  return await saveDiamondState(index, 'hidden', {});
}

// Vérifier si un diamant est disponible
export function isDiamondAvailable(index: number): boolean {
  const state = getDiamondState(index);
  if (!state) return false;
  
  // Vérifier l'expiration
  if (Date.now() > state.expiresAt) {
    return false;
  }
  
  return state.state === 'available';
}

// Vérifier si un diamant est collecté
export function isDiamondCollected(index: number): boolean {
  const state = getDiamondState(index);
  return state ? state.state === 'collected' : false;
}

// Vérifier si un diamant est tombé
export function isDiamondDropped(index: number): boolean {
  const state = getDiamondState(index);
  return state ? state.state === 'dropped' : false;
}

// Obtenir la position de spawn d'un diamant
export function getDiamondSpawnPosition(index: number): Vector3 | null {
  const state = getDiamondState(index);
  return state ? state.spawnPosition : null;
}

// Obtenir la position de drop d'un diamant
export function getDiamondDropPosition(index: number): Vector3 | null {
  const state = getDiamondState(index);
  return state ? state.dropPosition : null;
}

// Nettoyer les anciens états (plus de 24h) pour le joueur actuel
export async function cleanupOldDiamondStates(): Promise<void> {
  if (!currentPlayerId) {
    console.error('[DIAMOND_STATES] ❌ No player ID set for cleanup');
    return;
  }
  
  try {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 heures

    for (let i = 0; i < 5; i++) {
      const state = playerDiamondStates[`diamond_${i}`];
      if (state && (now - state.spawnedAt) > maxAge) {
        // Réinitialiser l'état pour les anciens diamants
        await saveDiamondState(i, 'available', {
          spawnPosition: state.spawnPosition,
          spawnedAt: now,
          expiresAt: now + (10 * 60 * 1000),
          collectedBy: null,
          collectedAt: null,
          dropPosition: null,
          droppedAt: null,
          droppedBy: null
        });
      }
    }
  } catch (error) {
    console.error('[DIAMOND_STATES] Error cleaning up old states:', error);
  }
}

// Synchroniser les états avec Firebase (polling) pour le joueur actuel
export async function syncDiamondStates(): Promise<void> {
  if (!currentPlayerId) {
    console.error('[DIAMOND_STATES] ❌ No player ID set for sync');
    return;
  }
  
  try {
    const response = await fetch(`${RTDB_URL}/players/${currentPlayerId}/diamonds.json`);
    
    if (response.ok) {
      const data: DiamondStatesData = await response.json();
      
      if (data) {
        // Mettre à jour les états locaux avec les données Firebase
        for (const [key, state] of Object.entries(data)) {
          const index = parseInt(key.replace('diamond_', ''));
          if (!isNaN(index)) {
            playerDiamondStates[key] = state;
          }
        }
      }
    }
  } catch (error) {
    // ✅ PROTECTION: Ignorer les erreurs d'annulation (CancellationTokenSource disposed)
    if (error instanceof Error && (error.message.includes('CancellationTokenSource') || error.message.includes('disposed'))) {
      return; // Ignorer silencieusement
    }
    console.error('[DIAMOND_STATES] Error syncing states:', error);
  }
}

// Système de listening en temps réel
let listeningActive = false;
let lastKnownStates: DiamondStatesData = {};

export function startDiamondStatesListening(): void {
  // ❌ MODE SOLO : Firebase désactivé pour les diamants
  // Pas de listening en temps réel
  // console.log('[DIAMOND_STATES] startDiamondStatesListening DISABLED (Single Player Mode)');
  listeningActive = true; // Marquer comme actif pour éviter les appels répétés
}

export function stopDiamondStatesListening(): void {
  listeningActive = false;
  // console.log('[DIAMOND_STATES] Real-time listening stopped');
}

// Callback pour déclencher les mises à jour visuelles
let diamondStatesUpdateCallback: (() => void) | null = null;

export function setDiamondStatesUpdateCallback(callback: () => void): void {
  diamondStatesUpdateCallback = callback;
}

function triggerDiamondStatesUpdate(): void {
  if (diamondStatesUpdateCallback) {
    diamondStatesUpdateCallback();
  }
}

// Gérer les timers de collecte
export async function updateDiamondCollectTimer(index: number, timer: number, startedAt: number): Promise<void> {
  // ✅ Garder l'état actuel du diamant - NE PAS écrire 'available'
  const currentState = getDiamondState(index);
  const currentDiamondState = currentState ? currentState.state : 'hidden';
  
  await saveDiamondState(index, currentDiamondState as any, {
    collectTimer: timer,
    collectTimerStartedAt: startedAt
  });
}

// Obtenir le timer de collecte avec calcul du temps restant
export function getDiamondCollectTimer(index: number): number {
  const state = getDiamondState(index);
  if (!state || !state.collectTimerStartedAt) return 0;
  
  const now = Date.now();
  const elapsed = (now - state.collectTimerStartedAt) / 1000; // en secondes
  const remaining = Math.max(0, state.collectTimer - elapsed);
  
  return remaining;
}

// Démarrer le timer de collecte
export async function startDiamondCollectTimer(index: number, duration: number): Promise<void> {
  const now = Date.now();
  await updateDiamondCollectTimer(index, duration, now);
}

// Arrêter le timer de collecte
export async function stopDiamondCollectTimer(index: number): Promise<void> {
  // ✅ Garder l'état actuel du diamant - NE PAS écrire 'collected'
  const currentState = getDiamondState(index);
  const currentDiamondState = currentState ? currentState.state : 'hidden';
  
  await saveDiamondState(index, currentDiamondState as any, {
    collectTimer: 0,
    collectTimerStartedAt: null
  });
}

// Créer les diamants initiaux si aucun n'existe pour le joueur actuel
export async function createInitialDiamondsIfNeeded(): Promise<void> {
  if (!currentPlayerId) {
    console.error('[DIAMOND_STATES] ❌ No player ID set for creating initial diamonds');
    return;
  }
  
  const hasAnyDiamond = Object.keys(playerDiamondStates).length > 0;
  
  if (!hasAnyDiamond) {
    console.log(`[DIAMOND_STATES] No diamonds found for player ${currentPlayerId}, creating initial diamonds...`);
    
    // Créer 5 diamants initiaux (selon DIAMOND_CONFIG.COUNT)
    // Tous commencent en état 'emerging' pour démarrer le cycle naturel
    for (let i = 0; i < 5; i++) {
      await saveDiamondState(i, 'emerging', {
        spawnPosition: Vector3.create(0, 0, 0), // Position temporaire, sera mise à jour par spawnDiamonds
        spawnedAt: Date.now(),
        collectTimer: 0, // Pas de timer au démarrage
        collectTimerStartedAt: null, // Timer démarrera quand le diamant passera à 'collectible'
        expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
      });
    }
    
    console.log(`[DIAMOND_STATES] Initial diamonds created successfully for player ${currentPlayerId} - positions will be generated by spawnDiamonds()`);
  } else {
    console.log(`[DIAMOND_STATES] Diamonds already exist for player ${currentPlayerId}, skipping creation to preserve timers`);
  }
}

// Initialiser le système de persistance des états pour un joueur
export async function initDiamondStatesPersistence(playerId: string): Promise<void> {
  console.log(`[DIAMOND_STATES] 🔄 Initializing diamond states persistence for player: ${playerId}`);
  
  // Initialiser les états pour ce joueur
  await initPlayerDiamondStates(playerId);
  await createInitialDiamondsIfNeeded();
  await cleanupOldDiamondStates();
  
  console.log(`[DIAMOND_STATES] ✅ Diamond states persistence initialized for player: ${playerId}`);
}