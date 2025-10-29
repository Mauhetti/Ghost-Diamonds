// src/robust-diamond-persistence.ts
// Système de persistance robuste pour les diamants avec sauvegardes multiples
// Optimisé pour éviter l'accumulation excessive de données Firebase

import { FIREBASE_CONFIG } from '../config-firebase';
import * as utils from '@dcl-sdk/utils';

const RTDB_URL = FIREBASE_CONFIG.RTDB_URL;

// Configuration des sauvegardes
const MAX_BACKUP_AGE = 7 * 24 * 60 * 60 * 1000; // 7 jours en millisecondes
const MAX_BACKUPS_PER_PLAYER = 3; // Maximum 3 sauvegardes par joueur

// ✅ MUTEX pour éviter les conflits d'écriture simultanés
let writeMutex = false;
const WRITE_TIMEOUT = 10000; // 10 secondes timeout pour les écritures

// ✅ Configuration des retry automatiques
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000; // 1 seconde entre les retry
const RETRY_BACKOFF_MULTIPLIER = 2; // Multiplier le délai par 2 à chaque retry

// ✅ Queue de sauvegardes échouées pour retry ultérieur
interface FailedSave {
  address: string;
  name: string;
  diamonds: number;
  attempts: number;
  lastAttempt: number;
}

// ✅ Interface pour les données de diamants
interface DiamondData {
  diamonds: number;
  name: string;
  timestamp: number;
  version: number;
  source: string;
}

let failedSavesQueue: FailedSave[] = [];
let isProcessingQueue = false;

// ✅ Sauvegarde locale comme fallback ultime
interface LocalDiamondData {
  address: string;
  name: string;
  diamonds: number;
  timestamp: number;
  version: number;
}

// Stockage local des diamants (fallback ultime)
let localDiamondStorage: Map<string, LocalDiamondData> = new Map();

// ✅ Métriques de monitoring
interface SaveMetrics {
  totalAttempts: number;
  successfulSaves: number;
  failedSaves: number;
  retryAttempts: number;
  localBackupsUsed: number;
  lastSaveTime: number;
}

let saveMetrics: SaveMetrics = {
  totalAttempts: 0,
  successfulSaves: 0,
  failedSaves: 0,
  retryAttempts: 0,
  localBackupsUsed: 0,
  lastSaveTime: 0
};

// ✅ Fonction pour obtenir les métriques
export function getSaveMetrics(): SaveMetrics {
  return { ...saveMetrics };
}

// ✅ Fonction pour réinitialiser les métriques
export function resetSaveMetrics(): void {
  saveMetrics = {
    totalAttempts: 0,
    successfulSaves: 0,
    failedSaves: 0,
    retryAttempts: 0,
    localBackupsUsed: 0,
    lastSaveTime: 0
  };
}

// ✅ Exposer les métriques globalement pour le debugging
(globalThis as any).getDiamondSaveMetrics = getSaveMetrics;
(globalThis as any).resetDiamondSaveMetrics = resetSaveMetrics;

// Types pour les sauvegardes
export type DiamondBackup = {
  diamonds: number;
  timestamp: number;
  version: number;
  source: 'primary' | 'backup1' | 'backup2' | 'local';
};

export type PlayerDiamondData = {
  name: string;
  diamonds: number;
  timestamp: number;
  version: number;
  backups?: {
    backup1?: DiamondBackup;
    backup2?: DiamondBackup;
    local?: DiamondBackup;
  };
};

// ✅ Fonction utilitaire pour acquérir le mutex
async function acquireWriteMutex(): Promise<boolean> {
  if (writeMutex) {
  // console.log('[ROBUST_DIAMONDS] Write mutex already acquired, waiting...');
    return false;
  }
  
  writeMutex = true;
  // console.log('[ROBUST_DIAMONDS] ✅ Write mutex acquired');
  
  // ✅ Utiliser utils.timers.setTimeout au lieu de setTimeout global
  utils.timers.setTimeout(() => {
    if (writeMutex) {
      writeMutex = false;
      // console.log('[ROBUST_DIAMONDS] ⚠️ Write mutex timeout, releasing');
    }
  }, WRITE_TIMEOUT);
  
  return true;
}

// ✅ Fonction utilitaire pour libérer le mutex
function releaseWriteMutex(): void {
  writeMutex = false;
  // console.log('[ROBUST_DIAMONDS] ✅ Write mutex released'); // DÉSACTIVÉ pour réduire les logs
}

// ✅ Fonction de retry avec backoff exponentiel
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxAttempts: number = MAX_RETRY_ATTEMPTS,
  baseDelay: number = RETRY_DELAY_MS
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // ✅ PROTECTION: Ignorer les erreurs d'annulation
      if (error instanceof Error && (error.message.includes('CancellationTokenSource') || error.message.includes('disposed'))) {
        throw error; // Propager immédiatement
      }
      
      if (attempt === maxAttempts) {
        console.error(`[ROBUST_DIAMONDS] ❌ Operation failed after ${maxAttempts} attempts:`, lastError);
        throw lastError;
      }
      
      // Calculer le délai avec backoff exponentiel
      const delay = baseDelay * Math.pow(RETRY_BACKOFF_MULTIPLIER, attempt - 1);
      // console.log(`[ROBUST_DIAMONDS] ⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
      
      await new Promise(resolve => utils.timers.setTimeout(() => resolve(undefined), delay));
    }
  }
  
  throw lastError!;
}

// Sauvegarde principale dans /players/{address} avec retry automatique
export async function savePlayerDiamondsPrimary(address: string, name: string, diamonds: number): Promise<boolean> {
  // ✅ PROTECTION: Acquérir le mutex pour éviter les conflits d'écriture
  const mutexAcquired = await acquireWriteMutex();
  if (!mutexAcquired) {
    // console.log('[ROBUST_DIAMONDS] ⚠️ Could not acquire write mutex, skipping save');
    return false;
  }

  try {
    // ✅ ÉCRIRE DIRECTEMENT DANS /players/{address} pour que les diamants soient visibles
    const data: PlayerDiamondData = {
      name,
      diamonds, // ✅ Les diamants sont directement dans l'objet
      timestamp: Date.now(),
      version: 2,
      backups: {
        backup1: {
          diamonds,
          timestamp: Date.now(),
          version: 2,
          source: 'backup1'
        },
        backup2: {
          diamonds,
          timestamp: Date.now(),
          version: 2,
          source: 'backup2'
        }
      }
    };

    // ✅ UTILISER RETRY AUTOMATIQUE - ADAPTÉ : Écrire dans players/{address}/diamondCount.json
    await retryWithBackoff(async () => {
      const resp = await fetch(`${RTDB_URL}/players/${address}/diamondCount.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
    });

    // console.log(`[ROBUST_DIAMONDS] ✅ Primary save successful: ${diamonds} diamonds for ${name}`); // DÉSACTIVÉ pour réduire les logs
    return true;
  } catch (e) {
    // ✅ PROTECTION: Ignorer les erreurs d'annulation (CancellationTokenSource disposed)
    if (e instanceof Error && (e.message.includes('CancellationTokenSource') || e.message.includes('disposed'))) {
      return false; // Ignorer silencieusement
    }
    console.error("[ROBUST_DIAMONDS] Primary save error:", e);
    return false;
  } finally {
    // ✅ CRITIQUE: Toujours libérer le mutex
    releaseWriteMutex();
  }
}

// Sauvegarde de secours dans /diamondBackups/{address}
export async function savePlayerDiamondsBackup(address: string, name: string, diamonds: number): Promise<boolean> {
  try {
    const data: DiamondBackup = {
      diamonds,
      timestamp: Date.now(),
      version: 2,
      source: 'backup1'
    };

    const resp = await fetch(`${RTDB_URL}/diamondBackups/${address}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!resp.ok) {
      console.error('[ROBUST_DIAMONDS] Backup save failed:', resp.status);
      return false;
    }

    return true;
  } catch (e) {
    // ✅ PROTECTION: Ignorer les erreurs d'annulation (CancellationTokenSource disposed)
    if (e instanceof Error && (e.message.includes('CancellationTokenSource') || e.message.includes('disposed'))) {
      return false; // Ignorer silencieusement
    }
    console.error("[ROBUST_DIAMONDS] Backup save error:", e);
    return false;
  }
}

// Sauvegarde globale dans /globalDiamondBackup
export async function saveGlobalDiamondBackup(address: string, name: string, diamonds: number): Promise<boolean> {
  try {
    const data = {
      [address]: {
        name,
        diamonds,
        timestamp: Date.now(),
        version: 2
      }
    };

    const resp = await fetch(`${RTDB_URL}/globalDiamondBackup.json`, {
      method: "PATCH", // PATCH pour ne pas écraser les autres joueurs
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!resp.ok) {
      console.error('[ROBUST_DIAMONDS] Global backup save failed:', resp.status);
      return false;
    }

    return true;
  } catch (e) {
    // ✅ PROTECTION: Ignorer les erreurs d'annulation (CancellationTokenSource disposed)
    if (e instanceof Error && (e.message.includes('CancellationTokenSource') || e.message.includes('disposed'))) {
      return false; // Ignorer silencieusement
    }
    console.error("[ROBUST_DIAMONDS] Global backup save error:", e);
    return false;
  }
}

// ✅ Sauvegarde locale comme fallback ultime
function savePlayerDiamondsLocally(address: string, name: string, diamonds: number): void {
  const localData: LocalDiamondData = {
    address,
    name,
    diamonds,
    timestamp: Date.now(),
    version: 2
  };
  
  localDiamondStorage.set(address, localData);
  saveMetrics.localBackupsUsed++;
  // console.log(`[ROBUST_DIAMONDS] 💾 Saved locally as fallback: ${diamonds} diamonds for ${name}`);
}

// ✅ Récupération depuis le stockage local
function loadPlayerDiamondsLocally(address: string): number {
  const localData = localDiamondStorage.get(address);
  if (localData) {
    // console.log(`[ROBUST_DIAMONDS] 💾 Loaded from local storage: ${localData.diamonds} diamonds for ${localData.name}`);
    return localData.diamonds;
  }
  return 0;
}

// Sauvegarde directe sans mutex pour la validation
export async function savePlayerDiamondsDirect(address: string, name: string, diamonds: number): Promise<boolean> {
  try {
    const data: DiamondData = {
      diamonds,
      name,
      timestamp: Date.now(),
      version: 2,
      source: 'validation_direct'
    };

    // Sauvegarde directe sans mutex
    const resp = await fetch(`${RTDB_URL}/players/${address}/diamondCount.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    // Toujours sauvegarder localement comme fallback
    savePlayerDiamondsLocally(address, name, diamonds);
    
    return true;
  } catch (e) {
    console.error("[ROBUST_DIAMONDS] Direct save error:", e);
    // En cas d'erreur, sauvegarder localement
    savePlayerDiamondsLocally(address, name, diamonds);
    return false;
  }
}

// Sauvegarde robuste avec plusieurs tentatives et nettoyage automatique
export async function savePlayerDiamondsRobust(address: string, name: string, diamonds: number): Promise<boolean> {
  // ✅ METTRE À JOUR LES MÉTRIQUES
  saveMetrics.totalAttempts++;
  saveMetrics.lastSaveTime = Date.now();
  
  const results = await Promise.allSettled([
    savePlayerDiamondsPrimary(address, name, diamonds),
    savePlayerDiamondsBackup(address, name, diamonds),
    saveGlobalDiamondBackup(address, name, diamonds)
  ]);

  const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
  const totalAttempts = results.length;

  // ✅ METTRE À JOUR LES MÉTRIQUES
  if (successCount > 0) {
    saveMetrics.successfulSaves++;
  } else {
    saveMetrics.failedSaves++;
  }

  // Limiter le nombre de sauvegardes pour ce joueur
  await limitPlayerBackups(address);

  // ✅ TOUJOURS sauvegarder localement comme fallback ultime
  savePlayerDiamondsLocally(address, name, diamonds);

  // Si aucune sauvegarde Firebase n'a réussi, ajouter à la queue de retry
  if (successCount === 0) {
    const failedSave: FailedSave = {
      address,
      name,
      diamonds,
      attempts: 0,
      lastAttempt: Date.now()
    };
    
    failedSavesQueue.push(failedSave);
    // console.log(`[ROBUST_DIAMONDS] ⚠️ All Firebase saves failed, added to retry queue. Local backup saved.`);
    
    // Démarrer le traitement de la queue si pas déjà en cours
    if (!isProcessingQueue) {
      processFailedSavesQueue();
    }
  }

  // ✅ RETOURNER TRUE même si Firebase échoue (car on a le fallback local)
  return true;
}

// ✅ Traitement de la queue de sauvegardes échouées
async function processFailedSavesQueue(): Promise<void> {
  if (isProcessingQueue || failedSavesQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  // console.log(`[ROBUST_DIAMONDS] 🔄 Processing ${failedSavesQueue.length} failed saves...`);
  
  const now = Date.now();
  const retryDelay = 5000; // 5 secondes entre les retry
  
  for (let i = failedSavesQueue.length - 1; i >= 0; i--) {
    const failedSave = failedSavesQueue[i];
    
    // Vérifier si assez de temps s'est écoulé depuis la dernière tentative
    if (now - failedSave.lastAttempt < retryDelay) {
      continue;
    }
    
    // Incrémenter le nombre de tentatives
    failedSave.attempts++;
    failedSave.lastAttempt = now;
    
    // console.log(`[ROBUST_DIAMONDS] 🔄 Retrying save for ${failedSave.name} (attempt ${failedSave.attempts})`);
    
    // ✅ METTRE À JOUR LES MÉTRIQUES DE RETRY
    saveMetrics.retryAttempts++;
    
    // Réessayer la sauvegarde
    const success = await savePlayerDiamondsRobust(failedSave.address, failedSave.name, failedSave.diamonds);
    
    if (success) {
      // Retirer de la queue si réussi
      failedSavesQueue.splice(i, 1);
      // console.log(`[ROBUST_DIAMONDS] ✅ Retry successful for ${failedSave.name}`);
    } else if (failedSave.attempts >= MAX_RETRY_ATTEMPTS) {
      // Retirer de la queue si trop de tentatives
      failedSavesQueue.splice(i, 1);
      // console.log(`[ROBUST_DIAMONDS] ❌ Max retry attempts reached for ${failedSave.name}, keeping local backup`);
    }
  }
  
  isProcessingQueue = false;
  
  // Programmer le prochain traitement si il reste des éléments
  if (failedSavesQueue.length > 0) {
    utils.timers.setTimeout(() => processFailedSavesQueue(), retryDelay);
  }
}

// Récupération directe sans mutex pour la validation
export async function loadPlayerDiamondsDirect(address: string): Promise<number> {
  try {
    const resp = await fetch(`${RTDB_URL}/players/${address}/diamondCount.json`);
    if (!resp.ok) {
      // Fallback vers le stockage local
      return loadPlayerDiamondsLocally(address);
    }
    
    const data = await resp.json();
    if (data && typeof data.diamonds === 'number') {
      return data.diamonds;
    }
    
    // Fallback vers le stockage local
    return loadPlayerDiamondsLocally(address);
  } catch (e) {
    console.error("[ROBUST_DIAMONDS] Direct load error:", e);
    // Fallback vers le stockage local
    return loadPlayerDiamondsLocally(address);
  }
}

// Récupération robuste avec plusieurs sources + fallback local
export async function loadPlayerDiamondsRobust(address: string): Promise<number> {
  
  const sources = await Promise.allSettled([
    // Source principale - ADAPTÉ : Lire depuis players/{address}/diamondCount.json
    fetch(`${RTDB_URL}/players/${address}/diamondCount.json`).then(r => r.ok ? r.json() : null),
    // Sauvegarde individuelle
    fetch(`${RTDB_URL}/diamondBackups/${address}.json`).then(r => r.ok ? r.json() : null),
    // Sauvegarde globale
    fetch(`${RTDB_URL}/globalDiamondBackup/${address}.json`).then(r => r.ok ? r.json() : null)
  ]);

  const diamonds: number[] = [];
  const sources_info: string[] = [];

  // Analyser les résultats Firebase
  sources.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      const data = result.value;
      let diamondCount = 0;
      let sourceName = '';

      switch (index) {
        case 0: // Source principale
          diamondCount = data.diamonds || 0;
          sourceName = 'primary';
          break;
        case 1: // Sauvegarde individuelle
          diamondCount = data.diamonds || 0;
          sourceName = 'backup1';
          break;
        case 2: // Sauvegarde globale
          diamondCount = data.diamonds || 0;
          sourceName = 'global';
          break;
      }

      if (diamondCount > 0) {
        diamonds.push(diamondCount);
        sources_info.push(`${sourceName}:${diamondCount}`);
      }
    }
  });

  // ✅ AJOUTER LE FALLBACK LOCAL
  const localDiamonds = loadPlayerDiamondsLocally(address);
  if (localDiamonds > 0) {
    diamonds.push(localDiamonds);
    sources_info.push(`local:${localDiamonds}`);
  }

  if (diamonds.length === 0) {
    return 0;
  }

  // Prendre la valeur la plus élevée (la plus récente/fiable)
  const maxDiamonds = Math.max(...diamonds);

  return maxDiamonds;
}

// Récupération automatique en cas de perte de données
export async function recoverPlayerDiamonds(address: string, name: string, currentDiamonds: number): Promise<number> {
  
  const recoveredDiamonds = await loadPlayerDiamondsRobust(address);
  
  if (recoveredDiamonds > currentDiamonds) {
    
    // Sauvegarder immédiatement la valeur récupérée
    await savePlayerDiamondsRobust(address, name, recoveredDiamonds);
    
    return recoveredDiamonds;
  }
  
  return currentDiamonds;
}

// Vérification périodique de l'intégrité des données
export async function verifyDiamondIntegrity(address: string, name: string, currentDiamonds: number): Promise<number> {
  
  const verifiedDiamonds = await loadPlayerDiamondsRobust(address);
  
  if (verifiedDiamonds !== currentDiamonds) {
    
    // Prendre la valeur la plus élevée
    const correctedDiamonds = Math.max(currentDiamonds, verifiedDiamonds);
    
    if (correctedDiamonds > currentDiamonds) {
      await savePlayerDiamondsRobust(address, name, correctedDiamonds);
      return correctedDiamonds;
    }
  }
  
  return currentDiamonds;
}

// Nettoyage des anciennes sauvegardes - DÉSACTIVÉ EN MODE SOLO
export async function cleanupOldBackups(): Promise<void> {
  // Mode solo : pas de nettoyage Firebase nécessaire pour éviter les erreurs CancellationTokenSource
  return;
}

// Fonction pour limiter le nombre de sauvegardes par joueur
async function limitPlayerBackups(address: string): Promise<void> {
  try {
    // Récupérer toutes les sauvegardes du joueur - ADAPTÉ : Lire depuis players/{address}/diamondCount.json
    const [primaryResp, backupResp, globalResp] = await Promise.allSettled([
      fetch(`${RTDB_URL}/players/${address}/diamondCount.json`),
      fetch(`${RTDB_URL}/diamondBackups/${address}.json`),
      fetch(`${RTDB_URL}/globalDiamondBackup/${address}.json`)
    ]);
    
    const backups: { source: string, data: any, timestamp: number }[] = [];
    
    // Collecter toutes les sauvegardes existantes
    if (primaryResp.status === 'fulfilled' && primaryResp.value.ok) {
      const data = await primaryResp.value.json();
      if (data) {
        backups.push({
          source: 'primary',
          data: data,
          timestamp: data.timestamp || 0
        });
      }
    }
    
    if (backupResp.status === 'fulfilled' && backupResp.value.ok) {
      const data = await backupResp.value.json();
      if (data) {
        backups.push({
          source: 'backup',
          data: data,
          timestamp: data.timestamp || 0
        });
      }
    }
    
    if (globalResp.status === 'fulfilled' && globalResp.value.ok) {
      const data = await globalResp.value.json();
      if (data) {
        backups.push({
          source: 'global',
          data: data,
          timestamp: data.timestamp || 0
        });
      }
    }
    
    // Trier par timestamp (plus récent en premier)
    backups.sort((a, b) => b.timestamp - a.timestamp);
    
    // Garder seulement les MAX_BACKUPS_PER_PLAYER plus récentes
    if (backups.length > MAX_BACKUPS_PER_PLAYER) {
      const toDelete = backups.slice(MAX_BACKUPS_PER_PLAYER);
      
      // Supprimer les anciennes sauvegardes
      for (const backup of toDelete) {
        if (backup.source === 'backup') {
          await fetch(`${RTDB_URL}/diamondBackups/${address}.json`, {
            method: "DELETE"
          });
        } else if (backup.source === 'global') {
          await fetch(`${RTDB_URL}/globalDiamondBackup/${address}.json`, {
            method: "DELETE"
          });
        }
      }
    }
    
  } catch (error) {
    console.error('[ROBUST_DIAMONDS] Error limiting player backups:', error);
  }
}