// src/systems/ghost-states-persistence.ts
// Système de persistance des états des fantômes sur Firebase

import { FIREBASE_CONFIG } from '../config-firebase';

const RTDB_URL = FIREBASE_CONFIG.RTDB_URL;
const SAVE_INTERVAL = 5000; // ✅ Sauvegarder toutes les 5 secondes (réduit de 1s à 5s)
const GHOST_COUNT = 200;
const POLLING_INTERVAL = 2000; // ✅ Lire les états toutes les 2 secondes (réduit de 500ms à 2s)
const LEADER_TIMEOUT = 30000; // Leader expire après 30 secondes

export type GhostState = 'patrol' | 'suspicion' | 'chase';

export interface GhostStateData {
  state: GhostState;
  alertLevel: number; // 0=none, 1=suspicion, 2=chase
  lastUpdate: number;
}

export interface GhostStates {
  [key: string]: GhostStateData;
}

let ghostStatesData: GhostStates = {};
let lastSaveTime = 0;
let lastLeaderCheckTime = 0;
let isInitialized = false;
let isLeader = false;
let lastPollTime = 0;

/**
 * Devenir le leader de la sauvegarde
 */
export async function becomeLeader(): Promise<boolean> {
  try {
    // Vérifier si le leader actuel a expiré
    const currentLeader = await fetch(`${RTDB_URL}/ghostStatesLeader.json`).then(r => r.ok ? r.json() : null);
    
    if (currentLeader) {
      const leaderAge = Date.now() - currentLeader.timestamp;
      if (leaderAge < LEADER_TIMEOUT) {
        console.log('[GHOST_STATES] Another player is still the leader');
        return false;
      } else {
        console.log('[GHOST_STATES] Current leader expired, taking over...');
      }
    }
    
    const response = await fetch(`${RTDB_URL}/ghostStatesLeader.json`, {
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
    console.log('[GHOST_STATES] ✅ This player is now the save leader');
    return true;
  } catch (error) {
    console.error('[GHOST_STATES] Failed to become leader:', error);
    return false;
  }
}

/**
 * Initialiser le système de persistance des états
 */
export async function initializeGhostStatesPersistence(): Promise<void> {
  if (isInitialized) {
    console.log('[GHOST_STATES] Already initialized, skipping...');
    return;
  }
  
  isInitialized = true;
  await becomeLeader();
  console.log('[GHOST_STATES] ✅ System initialized');
}

/**
 * Charger les états depuis Firebase
 */
export async function loadGhostStates(): Promise<GhostStates> {
  try {
    const response = await fetch(`${RTDB_URL}/ghostStates.json`);
    if (!response.ok) {
      return {};
    }
    
    const data = await response.json();
    ghostStatesData = data || {};
    
    return ghostStatesData;
  } catch (error) {
    console.error('[GHOST_STATES] Error loading ghost states:', error);
    return {};
  }
}

/**
 * Sauvegarder les états des fantômes
 * UNIQUEMENT si ce joueur est le leader
 */
export async function saveGhostStates(states: { index: number, state: GhostState, alertLevel: number }[]): Promise<void> {
  if (!isLeader) {
    return;
  }
  
  try {
    const now = Date.now();
    const statesData: GhostStates = {};
    
    for (const { index, state, alertLevel } of states) {
      statesData[`ghost_${index}`] = {
        state,
        alertLevel,
        lastUpdate: now
      };
    }
    
    const response = await fetch(`${RTDB_URL}/ghostStates.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statesData)
    });
    
    if (!response.ok) {
      console.error('[GHOST_STATES] Save failed:', response.status);
      return;
    }
    
    Object.assign(ghostStatesData, statesData);
    lastSaveTime = now;
  } catch (error) {
    console.error('[GHOST_STATES] Error saving ghost states:', error);
  }
}

/**
 * Obtenir l'état d'un fantôme spécifique
 */
export function getGhostState(ghostIndex: number): GhostStateData | null {
  const key = `ghost_${ghostIndex}`;
  return ghostStatesData[key] || null;
}

/**
 * Vérifier si on doit sauvegarder
 */
export async function checkAndRenewLeadership(): Promise<void> {
  if (!isLeader) return;
  
  const now = Date.now();
  if (now - lastLeaderCheckTime > 5000) { // Vérifier toutes les 5 secondes
    lastLeaderCheckTime = now;
    
    try {
      await fetch(`${RTDB_URL}/ghostStatesLeader.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaderId: Date.now(),
          timestamp: now
        })
      });
    } catch (error) {
      console.error('[GHOST_STATES] Failed to renew leadership:', error);
    }
  }
}

export function shouldSaveStates(currentTime: number): boolean {
  if (!isLeader) return false;
  return currentTime - lastSaveTime >= SAVE_INTERVAL;
}

/**
 * Marquer qu'une sauvegarde vient d'être effectuée
 */
export function markStatesSaved(currentTime: number): void {
  lastSaveTime = currentTime;
}

/**
 * Vérifier si on doit lire les états depuis Firebase
 */
export function shouldPollStates(currentTime: number): boolean {
  return currentTime - lastPollTime >= POLLING_INTERVAL;
}

/**
 * Marquer qu'une lecture vient d'être effectuée
 */
export function markStatesPolled(currentTime: number): void {
  lastPollTime = currentTime;
}

/**
 * Obtenir tous les états en mémoire
 */
export function getAllGhostStates(): GhostStates {
  return ghostStatesData;
}