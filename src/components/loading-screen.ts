// ============================================================================
// LOADING SCREEN COMPONENT
// ============================================================================
// Crée un écran de loading pour masquer la scène pendant le chargement
// ============================================================================

import { engine } from '@dcl/sdk/ecs';
import { Color4 } from '@dcl/sdk/math';
import { setLoadingScreenVisible, setLoadingText, getLoadingScreenVisible } from '../ui';

// ============================================================================
// LOADING SCREEN CONFIGURATION
// ============================================================================
const LOADING_CONFIG = {
  BACKGROUND_COLOR: Color4.create(0, 0, 0, 0.9), // Noir semi-transparent
  TEXT_COLOR: Color4.create(1, 1, 1, 1), // Blanc
  TEXT_SIZE: 24,
  ANIMATION_SPEED: 2.0 // Vitesse de l'animation des points
};

// ============================================================================
// LOADING SCREEN STATE
// ============================================================================
let loadingEntity: any = null;
let loadingText: any = null;
let animationTimer = 0;
let dotCount = 0;

// ============================================================================
// LOADING SCREEN FUNCTIONS
// ============================================================================

/**
 * Crée l'écran de loading avec animation (UI React)
 */
export function createLoadingScreen() {
  
  // Afficher l'écran de loading
  setLoadingScreenVisible(true);
  setLoadingText('Loading scene...');
  
  
  return null; // Pas d'entité ECS nécessaire avec React
}

/**
 * Met à jour l'animation du loading (à appeler dans le système principal)
 */
export function updateLoadingAnimation(dt: number) {
  if (!getLoadingScreenVisible()) return;
  
  // Ne pas animer les points pendant les descriptions fantaisistes
  // L'animation des points est désactivée pour éviter le scintillement
  // Les descriptions sont gérées par le loading manager avec un timer fixe
}

/**
 * Affiche l'écran de loading
 */
export function showLoadingScreen() {
  setLoadingScreenVisible(true);
}

/**
 * Cache l'écran de loading
 */
export function hideLoadingScreen() {
  setLoadingScreenVisible(false);
}

/**
 * Supprime complètement l'écran de loading
 */
export function removeLoadingScreen() {
  if (loadingEntity) {
    engine.removeEntity(loadingEntity);
    loadingEntity = null;
    loadingText = null;
  }
}

/**
 * Vérifie si l'écran de loading est actif
 */
export function isLoadingScreenActive(): boolean {
  return loadingEntity !== null;
}
