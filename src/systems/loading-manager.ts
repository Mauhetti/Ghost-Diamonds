// ============================================================================ 
// LOADING MANAGER SYSTEM
// ============================================================================ 
// Gère le chargement complet de la scène et l'affichage de l'écran de loading
// ============================================================================ 

import { engine, Entity, AudioSource, Transform } from '@dcl/sdk/ecs';
import { createLoadingScreen, showLoadingScreen, updateLoadingAnimation } from '../components/loading-screen';

import { updateLoadingProgress, setLoadingStep, showStartButton, triggerWhiteFlash } from '../ui';
import * as utils from '@dcl-sdk/utils';
import { createAndPlayAudio, stopAudio } from './audio-system';

// ============================================================================ 
// LOADING STATE MANAGEMENT
// ============================================================================ 
let isLoadingComplete = false;
let loadingStartTime = 0;
let loadingCheckInterval = 0;
let minimumLoadingTime = 13850; // 13.85 secondes minimum (6 étapes × 2s + 1.85s buffer) - Bouton 1.15s plus tôt
let loadingStepTimer = 0;
let currentStep = 0;
let allStepsCompleted = false;
let stepStartTime = 0;
let loadingMusicEntity: Entity | null = null;
let musicRetryCount = 0;
const MAX_MUSIC_RETRIES = 3;
let musicEntityId: number | null = null; // Garder l'ID de l'entité
let hasLoadingStarted = false; // Contrôle si le loading a commencé

// Composants à vérifier pour le chargement complet
const LOADING_COMPONENTS = {
  environment: false,
  ghosts: false,
  diamonds: false,
  player: false,
  safezones: false,
  leaderboard: false
};

// ============================================================================ 
// LOADING MANAGER FUNCTIONS
// ============================================================================ 

/**
 * Initialise le système de loading
 */
export function initializeLoadingManager() {
  
  // LANCER LA MUSIQUE AU DÉBUT DU LOADING
  const audioEntity = createAndPlayAudio();
  
  // Enregistrer le temps de début IMMÉDIATEMENT pour synchroniser avec la musique
  loadingStartTime = Date.now();
  
  // Créer l'écran de loading React ECS (plus sophistiqué)
  createLoadingScreen();
  showLoadingScreen();
  
  // DÉLAI DE 0.5 SECONDE AVANT DE COMMENCER LA BARRE DE LOADING
  utils.timers.setTimeout(() => {
    
    // Marquer que le loading a commencé
    hasLoadingStarted = true;
    
    // Enregistrer le temps de début du step
    stepStartTime = Date.now();
    
    // Commencer avec la première description
    setLoadingStep(0);
  }, 500);
  
  
  // Exposer la fonction startLoadingMusic globalement
  (globalThis as any).startLoadingMusic = startLoadingMusic;
  
  // Exposer les fonctions du système d'audio
  (globalThis as any).createSimpleAudio = createAndPlayAudio;
  (globalThis as any).stopAudio = stopAudio;
  
  // Exposer la fonction stopLoadingMusic pour arrêter la musique de loading
  (globalThis as any).stopLoadingMusic = stopLoadingMusic;
}

/**
 * Marque un composant comme chargé
 */
export function markComponentLoaded(component: keyof typeof LOADING_COMPONENTS) {
  LOADING_COMPONENTS[component] = true;
  
  // Don't update progress immediately - let the step-based progress handle it
  // This prevents the bar from jumping to 100% instantly
  
  // Vérifier si tout est chargé
  checkLoadingComplete();
}

/**
 * Vérifie si tous les composants sont chargés
 */
function checkLoadingComplete() {
  const allLoaded = Object.values(LOADING_COMPONENTS).every(loaded => loaded);
  
  if (allLoaded && !isLoadingComplete) {
    // Le bouton START est maintenant géré par le setTimeout de 12.050s dans initializeLoadingManager()
    // Cette fonction ne fait plus que marquer que le loading est prêt
  }
}

/**
 * Met à jour l'animation du loading
 */
export function updateLoadingManager(dt: number) {
  if (!isLoadingComplete && hasLoadingStarted) {
    // Mettre à jour l'animation du loading
    updateLoadingAnimation(dt);
    
    // Update loading steps with fixed 2-second timer
    const currentTime = Date.now();
    const stepDuration = currentTime - stepStartTime;
    
    if (stepDuration >= 2000 && currentStep < 6) { // Exactly 2 seconds per step
      currentStep++;
      setLoadingStep(currentStep);
      stepStartTime = currentTime; // Reset timer for next step
    }
    
    // Calculer le temps écoulé depuis le début du loading
    const totalTime = Date.now() - loadingStartTime;
    
    // La barre de progression se complète en 14 secondes (14000ms)
    const maxTime = 14000; // 14 secondes
    const progress = Math.min((totalTime / maxTime) * 100, 100);
    
    // Mettre à jour la barre de progression
    updateLoadingProgress(progress);
    
    // Afficher le bouton START quand la barre est complète (100%)
    if (progress >= 100 && !isLoadingComplete) {
      // console.log('[LOADING_MANAGER] Barre complète, trigger flash blanc'); // DÉSACTIVÉ pour réduire les logs
      // console.log('[LOADING_MANAGER] Progress:', progress, 'isLoadingComplete:', isLoadingComplete); // DÉSACTIVÉ pour réduire les logs
      // Flash blanc pendant 50ms
      triggerWhiteFlash();
      
      // Attendre 50ms avant d'afficher le bouton (sans cacher l'écran)
      utils.timers.setTimeout(() => {
        // console.log('[LOADING_MANAGER] Calling showStartButton()'); // DÉSACTIVÉ pour réduire les logs
        showStartButton();
        isLoadingComplete = true;
        // console.log('[LOADING_MANAGER] ✅ Loading complete, start button should be visible'); // DÉSACTIVÉ pour réduire les logs
      }, 50);
    }
    
    // Vérifier périodiquement l'état de chargement
    loadingCheckInterval += dt;
    if (loadingCheckInterval >= 1.0) { // Vérifier toutes les secondes
      loadingCheckInterval = 0;
    }
    
    // Forcer la vérification du loading même si tous les composants sont chargés
    checkLoadingComplete();
  }
}

/**
 * Vérifie si le loading est terminé
 */
export function isLoadingFinished(): boolean {
  return isLoadingComplete;
}

/**
 * Force la fin du loading (en cas d'urgence)
 */
export function forceLoadingComplete() {
  // Utiliser la fonction hideLoadingScreen de l'UI au lieu de celle du composant
  if ((globalThis as any).hideLoadingScreen) {
    (globalThis as any).hideLoadingScreen();
  }
  isLoadingComplete = true;
}

/**
 * Obtient l'état de chargement des composants
 */
export function getLoadingState() {
  return {
    ...LOADING_COMPONENTS,
    isLoadingComplete,
    loadingDuration: Date.now() - loadingStartTime
  };
}

/**
 * Prépare la musique de loading (sans la lancer)
 */
function prepareLoadingMusic() {
  
  // Vérifier si l'audio est déjà préparé
  if (loadingMusicEntity && musicEntityId) {
    return;
  }
  
  try {
    // Nettoyer l'entité précédente si elle existe
    if (loadingMusicEntity) {
      engine.removeEntity(loadingMusicEntity);
      loadingMusicEntity = null;
      musicEntityId = null;
    }
    
    loadingMusicEntity = engine.addEntity();
    musicEntityId = loadingMusicEntity;
    
    // Créer un Transform avec position fixe pour éviter le bug du scroll
    Transform.create(loadingMusicEntity, {
      position: { x: 160, y: 10, z: 160 }
    });
    
    // Créer l'audio mais en pause - conforme à la doc DCL pour Global Sounds
    AudioSource.create(loadingMusicEntity, {
      audioClipUrl: 'assets/scene/Audio/ghostdiamonds-intro.mp3',
      playing: false, // En pause au début
      loop: true,
      volume: 0.7,
      global: true
    });
    
    
    
  } catch (error) {
    console.error('[LOADING_MANAGER] ❌ Erreur lors de la préparation de l\'audio:', error);
  }
}

/**
 * Lance la musique de loading (après interaction utilisateur)
 */
export function startLoadingMusic() {
  
  // Essayer de récupérer l'entité par son ID si elle est null
  if (!loadingMusicEntity && musicEntityId) {
    loadingMusicEntity = musicEntityId as Entity;
  }
  
  if (!loadingMusicEntity) {
    console.error('[LOADING_MANAGER] ❌ Aucune entité audio préparée !');
    console.error('[LOADING_MANAGER] ❌ ID sauvegardé:', musicEntityId);
    return;
  }
  
  try {
    // Re-créer l'AudioSource avec playing = true pour s'assurer que global: true est bien appliqué
    AudioSource.createOrReplace(loadingMusicEntity, {
      audioClipUrl: 'assets/scene/Audio/ghostdiamonds-intro.mp3',
      playing: true,
      loop: true,
      volume: 0.7,
      global: true
    });
    
    console.log('[LOADING_MANAGER] ✅ Loading music started');
    
  } catch (error) {
    console.error('[LOADING_MANAGER] ❌ Erreur lors du lancement de l\'audio:', error);
  }
}

/**
 * Arrête la musique de loading avec fondu
 */
export function stopLoadingMusic() {
  console.log('[LOADING_MANAGER] stopLoadingMusic called, entity:', loadingMusicEntity);
  
  if (loadingMusicEntity) {
    try {
      // Arrêter la musique immédiatement
      AudioSource.getMutable(loadingMusicEntity).playing = false;
      console.log('[LOADING_MANAGER] ✅ Loading music stopped');
      
      // Supprimer l'entité après un court délai
      utils.timers.setTimeout(() => {
        if (loadingMusicEntity) {
          engine.removeEntity(loadingMusicEntity);
          console.log('[LOADING_MANAGER] ✅ Loading music entity removed');
          loadingMusicEntity = null;
          musicEntityId = null;
        }
      }, 1000);
      
    } catch (error) {
      console.error('[LOADING_MANAGER] ❌ Error stopping loading music:', error);
    }
  } else {
    console.log('[LOADING_MANAGER] No loading music entity to stop');
  }
}