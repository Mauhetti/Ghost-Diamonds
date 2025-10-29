// ============================================================================
// AUDIO SYSTEM
// ============================================================================
// Système dédié pour gérer l'audio dans la scène
// ============================================================================

import { engine, AudioSource, Transform } from '@dcl/sdk/ecs';
import * as utils from '@dcl-sdk/utils';

// ============================================================================
// AUDIO SYSTEM STATE
// ============================================================================
let audioEntity: any = null;
let isAudioPlaying = false;

// ============================================================================
// AUDIO SYSTEM FUNCTIONS
// ============================================================================

/**
 * Crée et lance un audio
 */
export function createAndPlayAudio() {
  
  try {
    // Nettoyer l'audio précédent si il existe
    if (audioEntity) {
      engine.removeEntity(audioEntity);
      audioEntity = null;
    }
    
    // Créer une nouvelle entité audio
    audioEntity = engine.addEntity();
    
    // Positionner l'audio près du joueur
    Transform.create(audioEntity, {
      position: { x: 160, y: 5, z: 160 }
    });
    
    // Créer l'audio source en mode global
    AudioSource.create(audioEntity, {
      audioClipUrl: 'assets/scene/Audio/ghostdiamonds-intro.mp3',
      loop: true,
      volume: 0.8,
      playing: false, // Commencer en pause
      global: true  // ✅ Son global (non positionnel) pour la musique de loading
    });
    
    // Forcer le lancement après un court délai
    utils.timers.setTimeout(() => {
      if (audioEntity) {
        try {
          // Re-créer l'AudioSource avec playing = true pour s'assurer que global: true est bien appliqué
          AudioSource.createOrReplace(audioEntity, {
            audioClipUrl: 'assets/scene/Audio/ghostdiamonds-intro.mp3',
            loop: true,
            volume: 0.8,
            playing: true,
            global: true
          });
          isAudioPlaying = true;
        } catch (error) {
          console.error('[AUDIO_SYSTEM] ❌ Erreur lancement forcé:', error);
        }
      }
    }, 0);
    
    
    // Vérifier l'état après un délai - DÉSACTIVÉ
    // utils.timers.setTimeout(() => { ... }, 1000);
    
    return audioEntity;
    
  } catch (error) {
    console.error('[AUDIO_SYSTEM] ❌ Erreur création audio:', error);
    return null;
  }
}

/**
 * Arrête l'audio
 */
export function stopAudio() {
  if (audioEntity) {
    try {
      AudioSource.getMutable(audioEntity).playing = false;
      isAudioPlaying = false;
    } catch (error) {
      console.error('[AUDIO_SYSTEM] ❌ Erreur arrêt audio:', error);
    }
  }
}

/**
 * Vérifie si l'audio est en cours de lecture
 */
export function isAudioCurrentlyPlaying(): boolean {
  return isAudioPlaying;
}

/**
 * Obtient l'entité audio
 */
export function getAudioEntity() {
  return audioEntity;
}

// ============================================================================
// BACKGROUND MUSIC SYSTEM
// ============================================================================
let backgroundMusicEntity: any = null;
let isBackgroundMusicInitialized = false;

/**
 * Crée l'entité audio pour la musique de fond
 */
export function initBackgroundMusicAudio() {
  if (isBackgroundMusicInitialized) return;
  
  // console.log('[AUDIO_SYSTEM] Creating background music entity...');
  backgroundMusicEntity = engine.addEntity();
  
  Transform.create(backgroundMusicEntity, {
    position: { x: 160, y: 10, z: 160 }
  });
  
  // console.log('[AUDIO_SYSTEM] Background music entity created:', backgroundMusicEntity);
  
  // Utiliser sdc-metamau-_original-mix_-2.mp3 pour la musique de fond
  AudioSource.create(backgroundMusicEntity, {
    audioClipUrl: 'assets/scene/Audio/sdc-metamau-_original-mix_-2.mp3',
    playing: false,
    loop: true,
    volume: 0.3,  // ✅ Réduit à 30% pour ne pas couvrir les sons
    global: true  // ✅ Son global (non positionnel) - parfait pour la musique de fond
  });
  
  // console.log('[AUDIO_SYSTEM] AudioSource component created for background music');
  isBackgroundMusicInitialized = true;
}

/**
 * Joue la musique de fond
 */
export function playBackgroundMusic() {
  // console.log('[AUDIO_SYSTEM] playBackgroundMusic called, entity:', backgroundMusicEntity);
  
  if (!backgroundMusicEntity) {
    console.error('[AUDIO_SYSTEM] Background music entity not initialized!');
    return;
  }
  
  try {
    // Re-créer l'AudioSource avec playing = true pour forcer la lecture
    // console.log('[AUDIO_SYSTEM] Re-creating AudioSource with playing=true...');
    AudioSource.createOrReplace(backgroundMusicEntity, {
      audioClipUrl: 'assets/scene/Audio/sdc-metamau-_original-mix_-2.mp3',
      playing: true,  // ✅ Démarrer immédiatement
      loop: true,
      volume: 0.3,  // ✅ Réduit à 30% pour ne pas couvrir les sons
      global: true
    });
    // console.log('[AUDIO_SYSTEM] ✅ Background music started');
  } catch (error) {
    console.error('[AUDIO_SYSTEM] ❌ Error starting background music:', error);
  }
}

/**
 * Obtient l'entité de la musique de fond
 */
export function getBackgroundMusicEntity() {
  return backgroundMusicEntity;
}

// ============================================================================
// EXPOSITION GLOBALE DES FONCTIONS AUDIO
// ============================================================================

/**
 * Expose les fonctions audio sur globalThis pour l'UI
 */
export function exposeAudioFunctionsGlobally() {
  (globalThis as any).playBackgroundMusic = playBackgroundMusic;
  (globalThis as any).stopAudio = stopAudio;
  (globalThis as any).getBackgroundMusicEntity = getBackgroundMusicEntity;
  
  // console.log('[AUDIO_SYSTEM] ✅ Audio functions exposed globally');
}