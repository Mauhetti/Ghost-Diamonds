import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import * as utils from '@dcl-sdk/utils'
import { isDeathTextVisible, isRegenTextVisible } from './systems/death'

// État global pour l'écran de loading
let showLoadingScreen = true
let loadingText = 'Loading...'
let loadingProgress = 0
let currentLoadingStep = 0
let isStartButtonVisible = false
let flashWhiteBackground = false

// Loading steps with immersive descriptions
const loadingSteps = [
  'Summoning ethereal spirits...',
  'Weaving magical diamond mechanisms...',
  'Establishing dimensional safe zones...',
  'Synchronizing with otherworldly realms...',
  'Calibrating ghost detection systems...',
  'Initializing multiplayer consciousness...',
  'Preparing the haunted dimension...'
]

// État global pour l'UI du joueur
let playerLives = 5
let playerMaxLives = 5
let playerDiamonds = 0
let nextRegenTime = 0
let playerStamina = 100

// Effet de flash du compteur de diamants
let diamondFlashVisible = false
let diamondFlashInProgress = false

function triggerDiamondCounterFlash() {
  if (diamondFlashInProgress) return
  diamondFlashInProgress = true
  // 3 flashes de 0.1s chacun (on/off)
  const intervals = [0, 100, 200, 300, 400, 500] // ms
  intervals.forEach((ms, idx) => {
    utils.timers.setTimeout(() => {
      diamondFlashVisible = idx % 2 === 0 // true on 0,200,400; false on 100,300,500
      if (idx === intervals.length - 1) {
        diamondFlashVisible = false
        diamondFlashInProgress = false
      }
    }, ms)
  })
}

export function LoadingScreen() {
  if (!showLoadingScreen) return null

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 }
      }}
      uiBackground={{ color: flashWhiteBackground ? Color4.create(1, 1, 1, 1) : Color4.create(0, 0, 0, 1) }}
    >
      {/* Ghost image */}
      <UiEntity
        uiTransform={{
          width: 400,
          height: 400,
          positionType: 'absolute',
          position: { top: '45%', left: '50%' },
          margin: { top: -350, left: -210 }
        }}
        uiBackground={{
          texture: { src: 'assets/scene/Images/ghosty.png' },
          textureMode: 'nine-slices',
          textureSlices: { top: 0, bottom: 0, left: 0, right: 0 }
        }}
      />

      {/* Loading text */}
      <UiEntity
        uiTransform={{
          width: 600,
          height: 50,
          positionType: 'absolute',
          position: { top: '50%', left: '50%' },
          margin: { top: -25, left: -300 }
        }}
        uiText={{
          value: isStartButtonVisible ? 'READY' : 'Loading...',
          fontSize: 20,
          color: Color4.create(1, 1, 1, 1),
          textAlign: 'middle-center'
        }}
      />

      {/* Loading description (dedicated line below progress bar) */}
      <UiEntity
        uiTransform={{
          width: 700,
          height: 60,
          positionType: 'absolute',
          position: { top: '55%', left: '50%' },
          margin: { top: 60, left: -350 }
        }}
        uiText={{
          value: loadingText,
          fontSize: 18,
          color: Color4.create(0.9, 0.9, 0.9, 1),
          textAlign: 'middle-center'
        }}
      />

      {/* Progress bar background */}
      <UiEntity
        uiTransform={{
          width: 400,
          height: 20,
          positionType: 'absolute',
          position: { top: '55%', left: '50%' },
          margin: { top: 20, left: -200 }
        }}
        uiBackground={{ color: Color4.create(0.2, 0.2, 0.2, 1) }}
      />

      {/* Progress bar fill */}
      <UiEntity
        uiTransform={{
          width: Math.max(4, Math.min(400, (400 * (loadingProgress || 0) / 100))),
          height: 20,
          positionType: 'absolute',
          position: { top: '55%', left: '50%' },
          margin: { top: 20, left: -200 }
        }}
        uiBackground={{ color: Color4.create(23/255, 45/255, 200/255, 1) }}
      />

      {/* Start button */}
      {isStartButtonVisible && (
        <UiEntity
          uiTransform={{
            width: 200,
            height: 60,
            positionType: 'absolute',
            position: { top: '70%', left: '50%' },
            margin: { top: 0, left: -100 }
          }}
          uiBackground={{ color: Color4.create(23/255, 45/255, 200/255, 1) }}
          onMouseDown={() => {
            // console.log('[UI] START button clicked - beginning audio transition');
            
            // Arrêter TOUTES les musiques de loading
            if ((globalThis as any).stopLoadingMusic) {
              // console.log('[UI] Stopping loading music...');
              (globalThis as any).stopLoadingMusic();
            }
            
            if ((globalThis as any).stopAudio) {
              // console.log('[UI] Stopping additional audio...');
              (globalThis as any).stopAudio();
            }
            
            hideLoadingScreen();
            
            // Call spawnPlayer function via global
            if ((globalThis as any).spawnPlayer) {
              // console.log('[UI] Spawning player...');
              (globalThis as any).spawnPlayer();
            }
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'START',
              fontSize: 24,
              color: Color4.create(1, 1, 1, 1),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>
      )}

      {/* Version text - coin bas droite */}
      <UiEntity
        uiTransform={{
          width: 80,
          height: 30,
          positionType: 'absolute',
          position: { bottom: 50, right: 50 }
        }}
        uiText={{
          value: 'V0.25',
          fontSize: 12,
          color: Color4.create(0.7, 0.7, 0.7, 0.8),
          textAlign: 'bottom-right'
        }}
      />
    </UiEntity>
  )
}

// Fonctions pour contrôler l'écran de loading
export function setLoadingScreenVisible(visible: boolean) {
  showLoadingScreen = visible
}

export function setLoadingText(text: string) {
  loadingText = text
}

export function getLoadingScreenVisible(): boolean {
  return showLoadingScreen
}

export function triggerWhiteFlash() {
  // console.log('[UI] triggerWhiteFlash appelé'); // DÉSACTIVÉ pour réduire les logs
  flashWhiteBackground = true
  // Reset après 50ms pour être visible
  utils.timers.setTimeout(() => {
    flashWhiteBackground = false
    // console.log('[UI] Flash blanc terminé'); // DÉSACTIVÉ pour réduire les logs
  }, 50)
}

// Fonctions pour mettre à jour l'UI du joueur
export function updatePlayerLives(lives: number, maxLives: number) {
  playerLives = lives
  playerMaxLives = maxLives
}

export function updatePlayerDiamonds(diamonds: number) {
  const previous = playerDiamonds
  playerDiamonds = diamonds
  if (diamonds > previous) {
    triggerDiamondCounterFlash()
  }
}

export function updateNextRegenTime(timeMs: number) {
  nextRegenTime = timeMs
}

export function updatePlayerStamina(stamina: number) {
  playerStamina = Math.max(0, Math.min(100, stamina))
}

// Loading screen control functions
export function updateLoadingProgress(progress: number) {
  loadingProgress = Math.min(100, Math.max(0, progress))
}

export function setLoadingStep(step: number) {
  if (step >= 0 && step < loadingSteps.length) {
    currentLoadingStep = step
    loadingText = loadingSteps[step]
  }
}

export function showStartButton() {
  // console.log('[UI] showStartButton() called'); // DÉSACTIVÉ pour réduire les logs
  isStartButtonVisible = true
  loadingText = 'Ready to run, dodge the ghosts and collect diamonds ?' // Garder le texte
  loadingProgress = 100
  // console.log('[UI] ✅ Start button should now be visible'); // DÉSACTIVÉ pour réduire les logs
}

export function hideStartButton() {
  isStartButtonVisible = false
}

// Exposer les fonctions de contrôle de l'UI sur globalThis
(globalThis as any).hideLoadingScreen = hideLoadingScreen;
(globalThis as any).showStartButton = showStartButton;
(globalThis as any).hideStartButton = hideStartButton;
(globalThis as any).updatePlayerDiamonds = updatePlayerDiamonds;


export function hideLoadingScreen() {
  showLoadingScreen = false
  
  // ✅ Arrêter la musique de loading
  // console.log('[UI] hideLoadingScreen() called - stopping loading music');
  
  if ((globalThis as any).stopLoadingMusic) {
    // console.log('[UI] Stopping loading music');
    (globalThis as any).stopLoadingMusic();
  }
  
  // Start background music avec un petit délai pour s'assurer que la musique de loading s'arrête
  utils.timers.setTimeout(() => {
    if ((globalThis as any).playBackgroundMusic) {
      // console.log('[UI] Starting background music');
      (globalThis as any).playBackgroundMusic();
    }
  }, 100); // 100ms de délai pour éviter les conflits audio
}

// Fonction principale pour rendre l'UI du joueur
export function renderPlayerUI() {
  // Ne pas afficher l'UI du joueur pendant le loading
  if (showLoadingScreen) return null;
  
  const showDeadText = isDeathTextVisible();
  const showRegenText = isRegenTextVisible();
  
  return (
    <UiEntity>
      {/* Texte DEAD ou WAIT LIFE REGEN au centre de l'écran */}
      {(showDeadText || showRegenText) && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            position: { top: 250, left: 0 },
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
            <UiEntity
              uiTransform={{
                width: 600,
                height: 150
              }}
              uiText={{
                value: showDeadText ? 'DEAD' : 'WAIT LIFE REGEN',
                fontSize: showDeadText ? 80 : 50,
                color: showDeadText ? Color4.create(1, 0, 0, 1) : Color4.create(0, 0.5, 1, 1), // Rouge pour DEAD, bleu pour WAIT LIFE REGEN
                textAlign: 'middle-center'
              }}
            />
        </UiEntity>
      )}
      
      {/* Container horizontal pour l'UI du joueur */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 60,
          positionType: 'absolute',
          position: { top: 20, left: 0 },
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* UI du joueur - Vies avec temps de récupération */}
        <UiEntity
          uiTransform={{
            width: 200,
            height: 50,
            margin: { right: 20 }
          }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.7) }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: playerLives < playerMaxLives 
                ? `❤️ ${playerLives} (${Math.ceil(nextRegenTime)}s life regen)`
                : `❤️ ${playerLives}`,
              fontSize: 16,
              color: Color4.create(1, 1, 1, 1),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>

        {/* UI du joueur - Diamants */}
        <UiEntity
          uiTransform={{
            width: 150,
            height: 50,
            margin: { right: 20 }
          }}
          uiBackground={{ color: diamondFlashVisible ? Color4.create(1, 1, 1, 1) : Color4.create(0, 0, 0, 0.7) }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `Diamonds : ${playerDiamonds}`,
              fontSize: 18,
              color: Color4.create(1, 1, 1, 1),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>

        {/* UI du joueur - Stamina */}
        <UiEntity
          uiTransform={{
            width: 200,
            height: 50,
            margin: { right: 20 }
          }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.7) }}
        >
          {/* Barre de stamina */}
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 20,
              positionType: 'absolute',
              position: { top: 5, left: 0 }
            }}
            uiBackground={{ color: Color4.create(0.2, 0.2, 0.2, 1) }}
          />
          
          {/* Remplissage de la stamina */}
          <UiEntity
            uiTransform={{
              width: Math.max(4, Math.min(200, (200 * (playerStamina || 0) / 100))),
              height: 20,
              positionType: 'absolute',
              position: { top: 5, left: 0 }
            }}
            uiBackground={{ 
              color: Color4.create(
                (playerStamina || 0) > 50 ? 0.09 : 1.0,  // Bleu si >50%, rouge si <50%
                (playerStamina || 0) > 50 ? 0.18 : 0.2,  // Bleu si >50%, rouge si <50%
                (playerStamina || 0) > 50 ? 0.78 : 0.2,  // Bleu si >50%, rouge si <50%
                1.0
              )
            }}
          />
          
          {/* Texte de stamina */}
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 20,
              positionType: 'absolute',
              position: { top: 25, left: 0 },
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: `Sprint Power ${Math.round(playerStamina || 0)}%`,
              fontSize: 14,
              color: Color4.create(1, 1, 1, 1),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>
        
        {/* Bouton de reset des diamants */}
        <UiEntity
          uiTransform={{
            width: 120,
            height: 40,
            positionType: 'absolute',
            position: { top: 10, left: 20 },
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiBackground={{ 
            color: Color4.create(0.8, 0.2, 0.2, 0.8)
          }}
          onMouseDown={() => {
            // console.log('[UI] 🔄 Reset diamond system button clicked');
            // Importer et exécuter la fonction de reset
            // Appeler directement la fonction de reset via globalThis
            if ((globalThis as any).resetDiamondCollectionSystem) {
              (globalThis as any).resetDiamondCollectionSystem();
            } else {
              console.error('[UI] ❌ Reset function not available');
            }
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'RESET DIAMONDS',
              fontSize: 12,
              color: Color4.create(1, 1, 1, 1),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}