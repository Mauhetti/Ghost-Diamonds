// src/remote-diamonds.ts
// Fonctions REST pour persistance des diamants via Firebase Realtime Database

import { FIREBASE_CONFIG } from '../config-firebase';

const RTDB_URL = FIREBASE_CONFIG.RTDB_URL;

// Player diamonds (individual count) - Save in player key - DÉSACTIVÉ EN MODE SOLO
export async function setPlayerDiamonds(address: string, name: string, diamonds: number) {
  return;
}

export async function getPlayerDiamonds(address: string) {
  try {
    const resp = await fetch(`${RTDB_URL}/players/${address}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error("[RTDB] Erreur getPlayerDiamonds:", e);
    return null;
  }
}

// Diamond state synchronization (positions, timers, states) - DÉSACTIVÉ EN MODE SOLO
export async function setDiamondState(positions: { x: number, y: number, z: number }[], states: string[], timers: number[], spawnTime: number, collectedBy?: { [key: number]: string }) {
  return;
}

// Charger l'état des diamants - DÉSACTIVÉ EN MODE SOLO
export async function getDiamondState() {
  return null;
}
