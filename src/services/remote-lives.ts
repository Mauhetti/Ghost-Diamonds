// src/remote-lives.ts
// Fonctions REST pour persistance des vies via Firebase Realtime Database
// ADAPTÉ : Écrit uniquement dans players/{address}/lives.json pour éviter les conflits

import { FIREBASE_CONFIG } from '../config-firebase';

const RTDB_URL = FIREBASE_CONFIG.RTDB_URL;

export async function setPlayerLife(address: string, name: string, lives: number, lastRegen?: number, regenQueue?: number[]) {
  try {
    const body = { 
      name, 
      lives, 
      maxLives: 10, 
      timestamp: Date.now(), 
      lastRegen: lastRegen || Date.now(),
      regenQueue: regenQueue || []
    };
    // ✅ ADAPTÉ : Écrire dans players/{address}/lives.json au lieu de players/{address}.json
    const resp = await fetch(`${RTDB_URL}/players/${address}/lives.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok) {
      console.error('[RTDB][LIVES][SET][ERREUR] Statut HTTP:', resp.status, 'corps:', data);
      return false; // Échec de sauvegarde
    }
    else {
      return true; // Succès
    }
  } catch (e) {
    console.error("[RTDB] Erreur setPlayerLife:", e);
    return false; // Échec de sauvegarde
  }
}

export async function getPlayerLife(address: string) {
  try {
    // ✅ ADAPTÉ : Lire depuis players/{address}/lives.json
    const resp = await fetch(`${RTDB_URL}/players/${address}/lives.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // console.log(`[DEBUG_FIREBASE] 📥 Raw fetch response:`, JSON.stringify(data, null, 2));
    return data;
  } catch (e) {
    console.error("[RTDB] Erreur getPlayerLife:", e);
    return null;
  }
}
