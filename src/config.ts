export const CONFIG = {
  GHOST: {
    COUNT: 200,
    PATROL_POINTS: 10,
    PATROL_SPEED_MIN: 1.3,
    PATROL_SPEED_MAX: 2.0,
    CHASE_SPEED: 8.57, // 9.02 - 5% = 8.57
    SPRINT_SPEED: 10.7,
    TURN_SPEED: 10.0,
    MODEL_YAW_OFFSET_DEG: 0, // pivot d'orientation (garde 0)
    MODEL_VISUAL_FIX_DEG: 90, // +180° par rapport au précédent, aligne avec la marche
    SEED: 1337,
    HEADING_LERP_SPEED: 8.0, // facteur de lissage du cap (par seconde)
    HEADING_EPS: 0.01, // seuil sous lequel on ne change pas d'orientation
    FADE: {
      ENABLED: true,
      SPEED: 0.1, // Hz (transition plus lente et douce)
      MIN_ALPHA: 0.05,
      MAX_ALPHA: 0.95
    }
  },
  SAFE_ZONE: {
    COUNT: 4,
    SIZE: 5,
    RADIUS: 2.5,
    CENTER_RADIUS: 15,
    CENTER: { x: 160, y: 1.5, z: 160 }, // Y fixe à 1.5 pour visibilité
    RANDOM_X: { MIN: 30, MAX: 290 },
    RANDOM_Z: { MIN: 30, MAX: 290 }
  },
  ALERT: {
    RADIUS: {
      IMMOBILE: 1,
      WALK: 10,
      RUN: 30,
      SPRINT: 100,
    },
    SPEED: {
      IMMOBILE: 1,
      WALK: 2,
      RUN: 9.44, // Seuil ajusté : détection fine des sprints, évite les chutes dans les trous
      SPRINT: 13.44 // sprint > 13.44
    },
    VISION: {
      ANGLE_DEG: 120, // Angle de vision en degrés (120° = 60° de chaque côté)
      HEIGHT_OFFSET: 1.5, // Hauteur des "yeux" du fantôme
      PLAYER_HEIGHT_OFFSET: 1.0 // Hauteur du joueur pour le calcul de vision
    },
    SUSPICION_TIMER: 1,
    CHASE_DURATION: 1.5,
    SPEED_SMOOTH_WINDOW: 10
  },
  PLAYER: {
    LIVES: 5,
    LIFE_REGEN_MINUTES: 1, // 1 minute
    LIFE_MAX_AUTO: 5,
    MS_IN_MIN: 60 * 1000,
    maxLives: 5
  },
  SKYBOX: {
    FIXED_TIME: 86340, // 23:59 = 23*3600 + 59*60 = 86340 secondes
    DESCRIPTION: "Heure fixée à 23:59 pour ambiance nocturne"
  },
  DEBUG: {
    HUD_PHASE: true,
    // HUD_OWNER_ADDRESS: '0x778a094cbff9fd2e5a27f6ad50993f1add00da39' // Retiré pour sécurité
  }
};
