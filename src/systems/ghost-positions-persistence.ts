// src/systems/ghost-positions-persistence.ts
// Système de persistance des positions des fantômes sur Firebase

import { Vector3 } from '@dcl/sdk/math';
import { FIREBASE_CONFIG } from '../config-firebase';

const RTDB_URL = FIREBASE_CONFIG.RTDB_URL;
const SAVE_INTERVAL = 10000; // ✅ Sauvegarder toutes les 10 secondes (réduit de 1s à 10s pour éviter la surcharge Firebase)
const GHOST_COUNT = 200;
const BATCH_SIZE = 50; // Sauvegarder 50 fantômes à la fois pour éviter les messages trop grands
const LEADER_TIMEOUT = 30000; // Leader expire après 30 secondes d'inactivité

export interface GhostPosition {
  x: number;
  y: number;
  z: number;
  lastSaved: number;
}

export interface GhostPositions {
  [key: string]: GhostPosition;
}

let ghostPositionsData: GhostPositions = {};
let lastSaveTime = 0;
let lastLeaderCheckTime = 0;
let isInitialized = false;
let isLeader = false;

/**
 * Charger les positions persistées depuis Firebase
 */
export async function loadGhostPositions(): Promise<GhostPositions> {
  try {
    const response = await fetch(`${RTDB_URL}/ghostPositions.json`);
    if (!response.ok) {
      console.log('[GHOST_PERSISTENCE] No saved positions found (normal on first load)');
      return {};
    }
    
    const data = await response.json();
    ghostPositionsData = data || {};
    
    console.log(`[GHOST_PERSISTENCE] ✅ Loaded ${Object.keys(ghostPositionsData).length} ghost positions from Firebase`);
    return ghostPositionsData;
  } catch (error) {
    console.error('[GHOST_PERSISTENCE] Error loading ghost positions:', error);
    return {};
  }
}

/**
 * Sauvegarder les positions actuelles des fantômes sur Firebase par batches
 * Pour éviter les messages trop grands, on sauvegarde par groupes de BATCH_SIZE
 * UNIQUEMENT si ce joueur est le leader
 */
export async function saveGhostPositions(positions: Vector3[]): Promise<void> {
  // Seul le leader sauvegarde pour éviter les duplicates et les coûts excessifs
  if (!isLeader) {
    return;
  }
  try {
    const now = Date.now();
    const numBatches = Math.ceil(positions.length / BATCH_SIZE);
    let savedCount = 0;
    
    // Sauvegarder par batches
    for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
      const start = batchIndex * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, positions.length);
      const batchData: GhostPositions = {};
      
      // Créer le batch de données
      for (let i = start; i < end; i++) {
        const pos = positions[i];
        if (pos) {
          batchData[`ghost_${i}`] = {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            lastSaved: now
          };
        }
      }
      
      // Sauvegarder ce batch sur Firebase (PATCH pour ne pas écraser les autres batches)
      const response = await fetch(`${RTDB_URL}/ghostPositions.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchData)
      });
      
      if (!response.ok) {
        console.error(`[GHOST_PERSISTENCE] Batch ${batchIndex + 1}/${numBatches} save failed:`, response.status);
        continue;
      }
      
      // Ajouter ce batch aux données en mémoire
      Object.assign(ghostPositionsData, batchData);
      savedCount += Object.keys(batchData).length;
      
      // Continuer au prochain batch (PATCH est assez rapide et non-bloquant)
    }
    
    console.log(`[GHOST_PERSISTENCE] ✅ Saved ${savedCount} ghost positions in ${numBatches} batches`);
    lastSaveTime = now;
  } catch (error) {
    console.error('[GHOST_PERSISTENCE] Error saving ghost positions:', error);
  }
}

/**
 * Obtenir la position persistée d'un fantôme spécifique
 */
export function getGhostPosition(ghostIndex: number): Vector3 | null {
  const key = `ghost_${ghostIndex}`;
  const posData = ghostPositionsData[key];
  
  if (!posData) return null;
  
  return Vector3.create(posData.x, posData.y, posData.z);
}

/**
 * Vérifier si une position sauvegardée existe pour ce fantôme
 */
export function hasGhostPosition(ghostIndex: number): boolean {
  const key = `ghost_${ghostIndex}`;
  return !!ghostPositionsData[key];
}

/**
 * Obtenir toutes les positions persistées
 */
export function getAllGhostPositions(): GhostPositions {
  return ghostPositionsData;
}

/**
 * Devenir le leader de la sauvegarde (seul le leader sauvegarde pour éviter les duplicates)
 */
export async function becomeLeader(): Promise<boolean> {
  try {
    // Vérifier si le leader actuel a expiré
    const currentLeader = await fetch(`${RTDB_URL}/ghostSaveLeader.json`).then(r => r.ok ? r.json() : null);
    
    if (currentLeader) {
      const leaderAge = Date.now() - currentLeader.timestamp;
      if (leaderAge < LEADER_TIMEOUT) {
        console.log('[GHOST_PERSISTENCE] Another player is still the leader');
        return false;
      } else {
        console.log('[GHOST_PERSISTENCE] Current leader expired, taking over...');
      }
    }
    
    // Tenter de prendre le rôle de leader
    const response = await fetch(`${RTDB_URL}/ghostSaveLeader.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leaderId: Date.now(),
        timestamp: Date.now()
      })
    });
    
    if (!response.ok) return false;
    
    isLeader = true;
    lastLeaderCheckTime = Date.now();
    console.log('[GHOST_PERSISTENCE] ✅ This player is now the save leader');
    return true;
  } catch (error) {
    console.error('[GHOST_PERSISTENCE] Failed to become leader:', error);
    return false;
  }
}

/**
 * Vérifier si ce joueur est toujours leader
 */
export function checkLeaderStatus(): boolean {
  // Si on n'est pas leader et qu'on n'a pas encore essayé, essayer
  if (!isLeader && !isInitialized) {
    isInitialized = true;
    becomeLeader(); // Appel non-bloquant
  }
  return isLeader;
}

/**
 * Initialiser le système (appelé au démarrage)
 */
export async function initializeGhostPersistence(): Promise<void> {
  if (isInitialized) {
    console.log('[GHOST_PERSISTENCE] Already initialized, skipping...');
    return;
  }
  
  isInitialized = true;
  await loadGhostPositions();
  await becomeLeader();
  console.log('[GHOST_PERSISTENCE] ✅ System initialized');
}

/**
 * Vérifier si on doit sauvegarder (toutes les X secondes)
 * UNIQUEMENT si ce joueur est le leader
 */
export async function checkAndRenewLeadership(): Promise<void> {
  if (!isLeader) return;
  
  const now = Date.now();
  if (now - lastLeaderCheckTime > 5000) { // Vérifier toutes les 5 secondes
    lastLeaderCheckTime = now;
    
    try {
      // Renouveler la position de leader pour montrer qu'on est toujours actif
      await fetch(`${RTDB_URL}/ghostSaveLeader.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaderId: Date.now(),
          timestamp: now
        })
      });
    } catch (error) {
      console.error('[GHOST_PERSISTENCE] Failed to renew leadership:', error);
    }
  }
}

export function shouldSavePositions(currentTime: number): boolean {
  if (!isLeader) return false; // Seul le leader sauvegarde
  return currentTime - lastSaveTime >= SAVE_INTERVAL;
}

/**
 * Marquer qu'une sauvegarde vient d'être effectuée
 */
export function markSaved(currentTime: number): void {
  lastSaveTime = currentTime;
}

